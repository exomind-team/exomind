package app.tauri.exomindsharehandoff

import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CancellationException
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Test

class ShareHandoffPolicyTest {
    @Test fun activityWakeAcceptsOnlyCanonicalHandoffIds() {
        val handoffId = java.util.UUID.randomUUID().toString()

        assertEquals(handoffId, canonicalShareHandoffId(handoffId))
        assertNull(canonicalShareHandoffId(null))
        assertNull(canonicalShareHandoffId("not-a-handoff"))
        assertNull(canonicalShareHandoffId(handoffId.uppercase()))
    }

    @Test fun routesSendActionsAndPreservesTextCaptionsAcrossFileMimes() {
        assertTrue(ShareHandoffPolicy.accepts("android.intent.action.SEND"))
        assertTrue(ShareHandoffPolicy.accepts("android.intent.action.SEND_MULTIPLE"))
        assertFalse(ShareHandoffPolicy.accepts("android.intent.action.VIEW"))
        assertEquals("caption", ShareHandoffPolicy.textPayload("android.intent.action.SEND", "image/png", "caption"))
        assertEquals("https://example.test", ShareHandoffPolicy.textPayload("android.intent.action.SEND_MULTIPLE", "application/pdf", "https://example.test"))
        assertNull(ShareHandoffPolicy.textPayload("android.intent.action.VIEW", "text/plain", "ignored"))
    }

    @Test fun deduplicatesUriGrantsWithoutReturningTheirText() {
        val uri = "content://private.provider/grant-secret"
        val first = ShareHandoffPolicy.dedupeIdentity("send", "image/png", null, listOf(uri))
        val second = ShareHandoffPolicy.dedupeIdentity("send", "image/png", null, listOf(uri))
        assertEquals(first, second)
        assertEquals(64, first.length)
        assertFalse(first.contains("private"))
        assertFalse(first.contains("grant-secret"))
    }

    @Test fun sanitizesDisplayMetadataAndEnforcesShareBounds() {
        assertEquals("photo.jpg", ShareHandoffPolicy.sanitizeName("../private/photo.jpg"))
        assertEquals("Shared file", ShareHandoffPolicy.sanitizeName(".."))
        assertEquals("image/jpeg", ShareHandoffPolicy.sanitizeMime("IMAGE/JPEG; charset=binary"))
        assertEquals("application/octet-stream", ShareHandoffPolicy.sanitizeMime("text/plain\r\n/path"))
        assertEquals("a\nb", ShareHandoffPolicy.sanitizeText("a\r\nb"))
        assertTrue(ShareHandoffPolicy.acceptsItemCount(256))
        assertFalse(ShareHandoffPolicy.acceptsItemCount(257))
        assertNull(ShareHandoffPolicy.itemCountError(256))
        assertEquals("size_mismatch", ShareHandoffPolicy.itemCountError(257))
        assertFalse(ShareHandoffPolicy.acceptsBounds(4L * 1024 * 1024 * 1024 + 1, 0))
        assertTrue(ShareHandoffPolicy.acceptsPendingQuota(31, 7L * 1024 * 1024 * 1024, 1024))
        assertFalse(ShareHandoffPolicy.acceptsPendingQuota(32, 0, 0))
        assertFalse(ShareHandoffPolicy.acceptsPendingQuota(0, 8L * 1024 * 1024 * 1024, 1))
        assertFalse(ShareHandoffPolicy.hasPendingContent("cancelled", "none", false, listOf("cancelled")))
        assertFalse(ShareHandoffPolicy.hasPendingContent("interrupted", "interrupted", false, listOf("interrupted")))
        assertTrue(ShareHandoffPolicy.hasPendingContent("cancelled", "none", false, listOf("ready")))
        assertTrue(ShareHandoffPolicy.hasPendingContent("receiving", "none", false, emptyList()))
    }

    @Test fun quotaFailurePreservesReadyPrefixAndTextWhileInterruptingOnlyCurrentItem() {
        val disposition = ShareHandoffPolicy.quotaFailureDisposition(
            text = "caption to keep",
            textState = "ready",
            itemStates = listOf("ready", "ready", "receiving"),
            currentItemIndex = 2,
        )

        assertEquals("interrupted", disposition.handoffState)
        assertEquals("quota_exceeded", disposition.handoffErrorCode)
        assertEquals("caption to keep", disposition.text)
        assertEquals("ready", disposition.textState)
        assertEquals(listOf("ready", "ready", "interrupted"), disposition.itemStates)
        assertEquals("quota_exceeded", disposition.currentItemErrorCode)
    }

    @Test fun contentFreeRejectedReceiptWindowPrunesOldestAndKeepsPayloadReceipts() {
        val safeTerminalErrors = listOf(
            "quota_exceeded", "size_mismatch", "permission_unavailable", "content_unavailable",
            "storage_unavailable", "interrupted", "cancelled",
        )
        val eligible = (0..ShareHandoffPolicy.MAX_CONTENT_FREE_RECEIPTS).map { index ->
            val errorCode = safeTerminalErrors[index % safeTerminalErrors.size]
            val cancelled = errorCode == "cancelled"
            ShareHandoffPolicy.ContentFreeReceipt(
                handoffId = "receipt-$index",
                receivedAtMs = index.toLong(),
                state = if (cancelled) "cancelled" else "interrupted",
                errorCode = errorCode,
                textState = if (cancelled) "none" else "interrupted",
                hasText = false,
                items = if (cancelled) listOf(ShareHandoffPolicy.ReceiptItem("cancelled", 0, false)) else emptyList(),
                hasCleanupQueue = false,
            )
        }
        val currentReceipt = eligible.last().copy(
            handoffId = "current-rejected",
            receivedAtMs = ShareHandoffPolicy.MAX_CONTENT_FREE_RECEIPTS.toLong(),
            state = "cancelled",
            errorCode = "cancelled",
            textState = "none",
            items = listOf(ShareHandoffPolicy.ReceiptItem("cancelled", 0, false)),
        )
        val protected = listOf(
            eligible.last().copy(handoffId = "ready", state = "ready"),
            eligible.last().copy(handoffId = "acknowledged", state = "acknowledged"),
            eligible.last().copy(handoffId = "text-payload", hasText = true),
            eligible.last().copy(
                handoffId = "ready-prefix",
                items = listOf(ShareHandoffPolicy.ReceiptItem("ready", 3, true)),
            ),
            eligible.last().copy(
                handoffId = "acknowledged-item",
                items = listOf(ShareHandoffPolicy.ReceiptItem("acknowledged", 0, false)),
            ),
            eligible.last().copy(
                handoffId = "partial-bytes",
                items = listOf(ShareHandoffPolicy.ReceiptItem("interrupted", 1, false)),
            ),
            eligible.last().copy(
                handoffId = "partial-hash",
                items = listOf(ShareHandoffPolicy.ReceiptItem("interrupted", 0, true)),
            ),
            eligible.last().copy(handoffId = "cleanup-queue", hasCleanupQueue = true),
        )

        val pruned = ShareHandoffPolicy.contentFreeReceiptIdsToPrune(eligible + currentReceipt + protected, "current-rejected")

        assertEquals(listOf("receipt-0", "receipt-1"), pruned)
        assertEquals(ShareHandoffPolicy.MAX_CONTENT_FREE_RECEIPTS, eligible.size + 1 - pruned.size)
        assertFalse(pruned.any { id -> protected.any { it.handoffId == id } })
        safeTerminalErrors.forEach { errorCode ->
            val row = eligible.first { it.errorCode == errorCode }
            assertTrue("$errorCode should be eligible when content-free", ShareHandoffPolicy.contentFreeReceiptIdsToPrune(
                (0 until ShareHandoffPolicy.MAX_CONTENT_FREE_RECEIPTS).map { row.copy(handoffId = "copy-$it", receivedAtMs = it.toLong()) } +
                    row.copy(handoffId = "current-$errorCode", receivedAtMs = Long.MAX_VALUE),
                "current-$errorCode",
            ).isNotEmpty())
        }
    }

    @Test fun receiverExecutorHasFiniteQueueAndRejectsWithoutRunningCallerTask() {
        val executor = createShareHandoffExecutor()
        val workersEntered = CountDownLatch(2)
        val releaseWorkers = CountDownLatch(1)
        val rejectedTaskRan = AtomicReference(false)
        try {
            repeat(2) {
                executor.execute {
                    workersEntered.countDown()
                    releaseWorkers.await()
                }
            }
            assertTrue(workersEntered.await(5, TimeUnit.SECONDS))
            assertEquals(ShareHandoffPolicy.MAX_QUEUED_RECEIVER_TASKS, executor.queue.remainingCapacity())
            repeat(ShareHandoffPolicy.MAX_QUEUED_RECEIVER_TASKS) { executor.execute {} }

            var rejected = false
            try {
                executor.execute { rejectedTaskRan.set(true) }
            } catch (_: RejectedExecutionException) {
                rejected = true
            }

            assertTrue(rejected)
            assertFalse(rejectedTaskRan.get())
            assertEquals("interrupted", ShareHandoffPolicy.RECEIVER_OVERLOAD_ERROR_CODE)
        } finally {
            releaseWorkers.countDown()
            executor.shutdownNow()
        }
    }

    @Test fun storagePermissionAndProviderFailuresHaveDistinctCodes() {
        assertEquals("storage_unavailable", ShareHandoffPolicy.errorCodeFor(ShareHandoffStorageFailure()))
        assertEquals("permission_unavailable", ShareHandoffPolicy.errorCodeFor(SecurityException()))
        assertEquals("content_unavailable", ShareHandoffPolicy.errorCodeFor(IOException()))
    }

    @Test fun receiptPersistenceFailureUsesGenericVisibleReshareFallback() {
        val message = ShareHandoffPolicy.RECEIPT_PERSISTENCE_FAILURE_MESSAGE

        assertTrue(ShareHandoffPolicy.shouldShowStorageFailureFallback(ShareHandoffStorageFailure()))
        assertFalse(ShareHandoffPolicy.shouldShowStorageFailureFallback(IOException()))
        assertTrue(message.contains("重新分享"))
        assertFalse(message.contains("content://"))
        assertFalse(message.contains("/"))
        assertFalse(message.contains("\\"))
    }

    @Test fun cancellationClosesOnlyTheStreamOwnedByThatHandoff() {
        class TrackedStream : ByteArrayInputStream(byteArrayOf(1, 2, 3)) {
            var closed = false
            override fun close() { closed = true }
        }

        val firstId = java.util.UUID.randomUUID().toString()
        val secondId = java.util.UUID.randomUUID().toString()
        val first = TrackedStream()
        val second = TrackedStream()
        BetaShareHandoffCancellation.begin(firstId)
        BetaShareHandoffCancellation.begin(secondId)
        BetaShareHandoffCancellation.open(firstId, {}, { first })
        BetaShareHandoffCancellation.open(secondId, {}, { second })

        assertTrue(BetaShareHandoffCancellation.cancel(firstId))
        assertTrue(first.closed)
        assertFalse(second.closed)
        assertTrue(BetaShareHandoffCancellation.isCancelled(firstId))
        assertFalse(BetaShareHandoffCancellation.isCancelled(secondId))
        assertFalse(BetaShareHandoffCancellation.complete(firstId))
        assertTrue(BetaShareHandoffCancellation.complete(secondId))
        assertFalse(BetaShareHandoffCancellation.cancel(secondId))
        BetaShareHandoffCancellation.finish(firstId)
        BetaShareHandoffCancellation.finish(secondId)
    }

    @Test fun cancellationDuringProviderOpenCancelsSignalAndClosesLateStream() {
        class TrackedStream : ByteArrayInputStream(byteArrayOf(1, 2, 3)) {
            var closed = false
            override fun close() { closed = true }
        }

        val handoffId = java.util.UUID.randomUUID().toString()
        val enteredOpen = CountDownLatch(1)
        val allowOpenToReturn = CountDownLatch(1)
        val cancelSignal = AtomicReference(false)
        val failure = AtomicReference<Throwable?>(null)
        val openedStream = TrackedStream()
        BetaShareHandoffCancellation.begin(handoffId)
        val opener = Thread {
            try {
                BetaShareHandoffCancellation.open(
                    handoffId,
                    { cancelSignal.set(true) },
                    {
                        enteredOpen.countDown()
                        allowOpenToReturn.await()
                        openedStream
                    },
                )
            } catch (error: Throwable) {
                failure.set(error)
            }
        }
        opener.start()
        enteredOpen.await()

        assertTrue(BetaShareHandoffCancellation.cancel(handoffId))
        assertTrue(cancelSignal.get())
        allowOpenToReturn.countDown()
        opener.join()

        assertTrue(openedStream.closed)
        assertTrue(failure.get() is CancellationException)
        BetaShareHandoffCancellation.finish(handoffId)
    }
}
