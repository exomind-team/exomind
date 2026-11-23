package app.tauri.exomindsharehandoff

import java.io.IOException
import java.security.MessageDigest

internal object ShareHandoffPolicy {
    private const val MAX_ITEMS = 256
    private const val MAX_NAME_CHARS = 180
    private const val MAX_TEXT_BYTES = 65_536
    private const val MAX_ITEM_BYTES = 4L * 1024 * 1024 * 1024
    private const val MAX_TOTAL_BYTES = 8L * 1024 * 1024 * 1024
    private const val MAX_PENDING_HANDOFFS = 32
    private const val MAX_PENDING_BYTES = 8L * 1024 * 1024 * 1024
    internal const val MAX_CONTENT_FREE_RECEIPTS = 128
    internal const val MAX_QUEUED_RECEIVER_TASKS = 32
    internal const val RECEIVER_OVERLOAD_ERROR_CODE = "interrupted"
    internal const val RECEIPT_PERSISTENCE_FAILURE_MESSAGE = "分享未能保存到本机，请检查可用存储空间后重新分享"
    private val mimePattern = Regex("^[a-z0-9!#\$&^_.+-]+/[a-z0-9!#\$&^_.+*-]+\$")
    private val boundedReceiptErrorCodes = setOf(
        "quota_exceeded", "size_mismatch", "permission_unavailable", "content_unavailable",
        "storage_unavailable", "interrupted", "cancelled",
    )

    fun accepts(action: String?): Boolean = action == "android.intent.action.SEND" || action == "android.intent.action.SEND_MULTIPLE"
    fun textPayload(action: String?, @Suppress("UNUSED_PARAMETER") mime: String?, extraText: String?): String? =
        if (accepts(action)) sanitizeText(extraText) else null
    fun acceptsItemCount(count: Int): Boolean = count in 0..MAX_ITEMS
    fun itemCountError(count: Int): String? = if (acceptsItemCount(count)) null else "size_mismatch"
    fun acceptsBounds(itemBytes: Long, totalBytes: Long): Boolean = itemBytes in 0..MAX_ITEM_BYTES && totalBytes in 0..MAX_TOTAL_BYTES
    fun acceptsPendingQuota(pendingCount: Int, pendingBytes: Long, incomingBytes: Long): Boolean =
        pendingCount in 0 until MAX_PENDING_HANDOFFS && pendingBytes >= 0 && incomingBytes >= 0 &&
            incomingBytes <= MAX_PENDING_BYTES && pendingBytes <= MAX_PENDING_BYTES - incomingBytes

    fun acceptsPendingBytes(pendingBytes: Long, incomingBytes: Long): Boolean =
        pendingBytes >= 0 && incomingBytes >= 0 && incomingBytes <= MAX_PENDING_BYTES &&
            pendingBytes <= MAX_PENDING_BYTES - incomingBytes

    fun errorCodeFor(error: Throwable): String = when (error) {
        is ShareHandoffStorageFailure -> "storage_unavailable"
        is SecurityException -> "permission_unavailable"
        is IOException -> "content_unavailable"
        else -> "content_unavailable"
    }

    fun shouldShowStorageFailureFallback(error: Throwable): Boolean =
        error is ShareHandoffStorageFailure

    data class ContentFreeReceipt(
        val handoffId: String,
        val receivedAtMs: Long,
        val state: String,
        val errorCode: String,
        val textState: String,
        val hasText: Boolean,
        val items: List<ReceiptItem>,
        val hasCleanupQueue: Boolean,
    )

    data class ReceiptItem(
        val state: String,
        val byteLength: Long,
        val hasSha256: Boolean,
    )

    data class QuotaFailureDisposition(
        val handoffState: String,
        val handoffErrorCode: String,
        val text: String?,
        val textState: String,
        val itemStates: List<String>,
        val currentItemErrorCode: String?,
    )

    fun quotaFailureDisposition(
        text: String?,
        textState: String,
        itemStates: List<String>,
        currentItemIndex: Int,
    ): QuotaFailureDisposition {
        val interruptedItems = itemStates.toMutableList()
        if (currentItemIndex in interruptedItems.indices && interruptedItems[currentItemIndex] != "ready") {
            interruptedItems[currentItemIndex] = "interrupted"
        }
        return QuotaFailureDisposition(
            handoffState = "interrupted",
            handoffErrorCode = "quota_exceeded",
            text = text,
            textState = textState,
            itemStates = interruptedItems,
            currentItemErrorCode = "quota_exceeded",
        )
    }

    fun contentFreeReceiptIdsToPrune(
        receipts: List<ContentFreeReceipt>,
        keepId: String,
    ): List<String> {
        val eligible = receipts.filter(::isContentFreeReceipt)
        val excess = (eligible.size - MAX_CONTENT_FREE_RECEIPTS).coerceAtLeast(0)
        if (excess == 0) return emptyList()
        return eligible.asSequence()
            .filter { it.handoffId != keepId }
            .sortedWith(compareBy<ContentFreeReceipt> { it.receivedAtMs }.thenBy { it.handoffId })
            .take(excess)
            .map { it.handoffId }
            .toList()
    }

    private fun isContentFreeReceipt(receipt: ContentFreeReceipt): Boolean =
        receipt.state in setOf("interrupted", "cancelled") &&
            receipt.textState in setOf("none", "interrupted", "cancelled") &&
            !receipt.hasText &&
            receipt.items.all { item ->
                item.state in setOf("interrupted", "cancelled") &&
                    item.byteLength == 0L && !item.hasSha256
            } &&
            !receipt.hasCleanupQueue &&
            receipt.errorCode in boundedReceiptErrorCodes

    fun hasPendingContent(state: String, textState: String, hasText: Boolean, itemStates: List<String>): Boolean =
        state == "receiving"
            || (hasText && textState in setOf("ready", "receiving"))
            || itemStates.any { it == "ready" || it == "receiving" }

    fun sanitizeText(value: String?): String? {
        if (value == null) return null
        val normalized = value.replace("\r\n", "\n").replace('\r', '\n')
        require(normalized.toByteArray(Charsets.UTF_8).size <= MAX_TEXT_BYTES) { "shared text exceeds size limit" }
        return normalized.filter { it == '\n' || it == '\t' || !it.isISOControl() }.takeIf { it.isNotBlank() }
    }

    fun sanitizeName(value: String): String {
        val basename = value.substringAfterLast('/').substringAfterLast('\\')
        val safe = basename.filter { !it.isISOControl() && it != '/' && it != '\\' }.trim().take(MAX_NAME_CHARS)
        return safe.takeUnless { it.isBlank() || it == "." || it == ".." } ?: "Shared file"
    }

    fun sanitizeMime(value: String): String {
        val candidate = value.lowercase().substringBefore(';').trim()
        return candidate.takeIf { it.length <= 127 && mimePattern.matches(it) } ?: "application/octet-stream"
    }

    fun dedupeIdentity(action: String?, mime: String?, text: String?, uriTokens: List<String>): String {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update((action ?: "").toByteArray(Charsets.UTF_8)); digest.update(0.toByte())
        digest.update((mime ?: "").toByteArray(Charsets.UTF_8)); digest.update(0.toByte())
        digest.update((text ?: "").toByteArray(Charsets.UTF_8))
        uriTokens.forEach { digest.update(0.toByte()); digest.update(it.toByteArray(Charsets.UTF_8)) }
        return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
    }
}

internal class ShareHandoffStorageFailure : Exception()
