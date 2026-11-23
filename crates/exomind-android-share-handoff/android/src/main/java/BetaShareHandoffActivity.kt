package app.tauri.exomindsharehandoff

import android.app.Activity
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.provider.OpenableColumns
import android.system.Os
import android.system.OsConstants
import android.util.Log
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CancellationException
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

internal fun createShareHandoffExecutor(): ThreadPoolExecutor = ThreadPoolExecutor(
    2,
    2,
    0L,
    TimeUnit.MILLISECONDS,
    ArrayBlockingQueue<Runnable>(ShareHandoffPolicy.MAX_QUEUED_RECEIVER_TASKS),
)

/** System receiver copies grants to app-private storage before forwarding only an ID. */
class BetaShareHandoffActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val incoming = intent
        try {
            executor.execute {
                val showReceiptFailure = try {
                    stage(incoming)
                    false
                } catch (error: Exception) {
                    val showFallback = ShareHandoffPolicy.shouldShowStorageFailureFallback(error)
                    Log.w(TAG, if (showFallback) "Share handoff receipt could not be saved" else "Share handoff staging failed")
                    showFallback
                }
                runOnUiThread {
                    if (showReceiptFailure) showReceiptPersistenceFallback()
                    finish()
                }
            }
        } catch (_: RejectedExecutionException) {
            val receiptSaved = try {
                persistRejectedIntent(incoming, ShareHandoffPolicy.RECEIVER_OVERLOAD_ERROR_CODE)
                true
            } catch (_: Exception) {
                Log.w(TAG, "Share handoff overload receipt could not be saved")
                false
            }
            runOnUiThread {
                if (!receiptSaved) showReceiptPersistenceFallback()
                finish()
            }
        }
    }

    private fun stage(incoming: Intent) {
        val input = try {
            route(incoming)
        } catch (error: Exception) {
            val code = (error as? StageFailure)?.code ?: "size_mismatch"
            persistRejectedIntent(incoming, code)
            return
        }
        if (input == null) return
        val root = File(applicationInfo.dataDir, ROOT_NAME)
        synchronized(quotaLock) {
            ensurePrivateRoot(root)
            recover(root)
        }
        val identity = digestIdentity(incoming, input)

        val handoffId = UUID.randomUUID().toString()
        val textBytes = input.text?.toByteArray(Charsets.UTF_8)?.size?.toLong() ?: 0L
        val items = JSONArray()
        val record = JSONObject()
            .put("handoff_id", handoffId)
            .put("received_at_ms", System.currentTimeMillis())
            .put("state", "receiving")
            .put("identity", identity)
            .put("bound_profile_id", JSONObject.NULL)
            .put("error_code", JSONObject.NULL)
            .put("text", input.text ?: JSONObject.NULL)
            .put("text_state", if (input.text == null) "none" else "ready")
            .put("items", items)
        val manifest = File(root, "$handoffId.json")
        var quotaRejected = false
        var duplicateId: String? = null
        synchronized(quotaLock) {
            duplicateId = readDeduped(root, identity) ?: stagingIdentities[identity]
            if (duplicateId == null) {
                val usage = pendingUsage(root)
                if (!ShareHandoffPolicy.acceptsPendingQuota(usage.first, usage.second, textBytes)) {
                    persistQuotaFailure(root, handoffId, identity)
                    quotaRejected = true
                } else {
                    stagingIdentities[identity] = handoffId
                    BetaShareHandoffCancellation.begin(handoffId)
                    try {
                        writeAtomic(manifest, record.toString().toByteArray(Charsets.UTF_8))
                    } catch (error: Exception) {
                        if (stagingIdentities[identity] == handoffId) stagingIdentities.remove(identity)
                        BetaShareHandoffCancellation.finish(handoffId)
                        throw error
                    }
                }
            }
        }
        duplicateId?.let { launchMain(it); return }
        if (quotaRejected) {
            launchMain(handoffId)
            return
        }

        var activePartial: File? = null
        var currentItem: JSONObject? = null
        try {
            launchMain(handoffId)
        } catch (error: Exception) {
            BetaShareHandoffCancellation.finish(handoffId)
            synchronized(quotaLock) {
                if (stagingIdentities[identity] == handoffId) stagingIdentities.remove(identity)
            }
            throw error
        }
        try {
            var total = textBytes
            for (source in input.files) {
                checkCancelled(handoffId)
                if (!ShareHandoffPolicy.acceptsItemCount(items.length() + 1)) throw StageFailure("size_mismatch")
                val itemId = UUID.randomUUID().toString()
                val item = JSONObject()
                    .put("item_id", itemId)
                    .put("name", "Shared file")
                    .put("media_type", "application/octet-stream")
                    .put("byte_length", 0L)
                    .put("sha256", JSONObject.NULL)
                    .put("state", "receiving")
                    .put("error_code", JSONObject.NULL)
                items.put(item)
                currentItem = item
                writeAtomic(manifest, record.put("items", items).toString().toByteArray(Charsets.UTF_8))
                val metadata = queryMetadata(source)
                if (metadata.size != null) {
                    synchronized(quotaLock) {
                        val usage = pendingUsage(root)
                        if (!ShareHandoffPolicy.acceptsPendingBytes(usage.second, metadata.size)) {
                            throw StageFailure("quota_exceeded")
                        }
                        item.put("name", metadata.name).put("media_type", metadata.mediaType).put("byte_length", metadata.size)
                        writeAtomic(manifest, record.put("items", items).toString().toByteArray(Charsets.UTF_8))
                    }
                } else {
                    item.put("name", metadata.name).put("media_type", metadata.mediaType)
                    writeAtomic(manifest, record.put("items", items).toString().toByteArray(Charsets.UTF_8))
                }
                val output = File(root, "$itemId.bin")
                val partial = File(root, "$itemId.part")
                activePartial = partial
                val digest = MessageDigest.getInstance("SHA-256")
                val signal = CancellationSignal()
                val stream = BetaShareHandoffCancellation.open(
                    handoffId,
                    { signal.cancel() },
                    { contentResolver.openAssetFileDescriptor(source.uri, "r", signal)?.createInputStream() },
                ) ?: throw StageFailure("content_unavailable")
                var copied = 0L
                try {
                    stream.use { owned ->
                        val outputStream = try { FileOutputStream(partial) } catch (_: Exception) { throw ShareHandoffStorageFailure() }
                        try {
                            outputStream.use { outputStream ->
                                val buffer = ByteArray(COPY_BUFFER_BYTES)
                                while (true) {
                                    checkCancelled(handoffId)
                                    val read = try { owned.read(buffer) } catch (_: IOException) { throw StageFailure("content_unavailable") }
                                    checkCancelled(handoffId)
                                    if (read < 0) break
                                    if (read == 0) continue
                                    copied = Math.addExact(copied, read.toLong())
                                    if (!ShareHandoffPolicy.acceptsBounds(copied, total + copied)) throw StageFailure("size_mismatch")
                                    if (metadata.size != null && copied > metadata.size) throw StageFailure("size_mismatch")
                                    synchronized(quotaLock) {
                                        if (metadata.size == null) {
                                            val usage = pendingUsage(root)
                                            if (!ShareHandoffPolicy.acceptsPendingBytes(usage.second, read.toLong())) {
                                                throw StageFailure("quota_exceeded")
                                            }
                                        }
                                        try { outputStream.write(buffer, 0, read) } catch (_: IOException) { throw ShareHandoffStorageFailure() }
                                    }
                                    digest.update(buffer, 0, read)
                                }
                                try { outputStream.fd.sync() } catch (_: IOException) { throw ShareHandoffStorageFailure() }
                            }
                        } catch (error: IOException) {
                            throw ShareHandoffStorageFailure()
                        }
                    }
                } catch (error: Exception) {
                    BetaShareHandoffCancellation.detach(handoffId, stream)
                    if (BetaShareHandoffCancellation.isCancelled(handoffId)) throw CancellationException("handoff cancelled")
                    throw error
                } finally {
                    BetaShareHandoffCancellation.detach(handoffId, stream)
                }
                checkCancelled(handoffId)
                if (metadata.size != null && metadata.size != copied) throw StageFailure("size_mismatch")
                try { Os.rename(partial.absolutePath, output.absolutePath) } catch (_: Exception) { throw ShareHandoffStorageFailure() }
                activePartial = null
                total += copied
                item.put("byte_length", copied)
                    .put("sha256", digest.digest().toHex())
                    .put("state", "ready")
                writeAtomic(manifest, record.put("items", items).toString().toByteArray(Charsets.UTF_8))
            }
            checkCancelled(handoffId)
            if (!BetaShareHandoffCancellation.complete(handoffId)) throw CancellationException("handoff cancelled")
            record.put("state", "ready")
            writeAtomic(manifest, record.toString().toByteArray(Charsets.UTF_8))
            writeDeduped(root, identity, handoffId)
        } catch (error: CancellationException) {
            activePartial?.delete()
            if (currentItem?.optString("state") != "ready") {
                currentItem?.let { deleteCurrentItemFiles(root, it) }
                currentItem?.put("byte_length", 0L)?.put("sha256", JSONObject.NULL)
                    ?.put("state", "cancelled")?.put("error_code", "cancelled")
            }
            record.put("state", "cancelled").put("error_code", "cancelled").put("items", items)
            writeAtomic(manifest, record.toString().toByteArray(Charsets.UTF_8))
        } catch (error: Exception) {
            activePartial?.delete()
            val code = classifyStageFailure(error)
            if (code == "quota_exceeded") {
                val disposition = ShareHandoffPolicy.quotaFailureDisposition(
                    record.opt("text") as? String,
                    record.optString("text_state"),
                    (0 until items.length()).map { items.getJSONObject(it).optString("state") },
                    items.length() - 1,
                )
                currentItem?.let {
                    if (it.optString("state") != "ready") {
                        deleteCurrentItemFiles(root, it)
                        it.put("byte_length", 0L).put("sha256", JSONObject.NULL)
                            .put("state", disposition.itemStates.getOrNull(items.length() - 1) ?: "interrupted")
                            .put("error_code", disposition.currentItemErrorCode)
                    }
                }
                record.put("state", disposition.handoffState)
                    .put("error_code", disposition.handoffErrorCode)
                    .put("text", disposition.text ?: JSONObject.NULL)
                    .put("text_state", disposition.textState)
                    .put("items", items)
            } else {
                if (currentItem?.optString("state") != "ready") currentItem?.let {
                    deleteCurrentItemFiles(root, it)
                    it.put("byte_length", 0L).put("sha256", JSONObject.NULL)
                        .put("state", "interrupted").put("error_code", code)
                }
                record.put("state", "interrupted").put("error_code", code).put("items", items)
            }
            writeAtomic(manifest, record.toString().toByteArray(Charsets.UTF_8))
            if (code == "quota_exceeded") pruneContentFreeReceipts(root, handoffId)
        } finally {
            BetaShareHandoffCancellation.finish(handoffId)
            synchronized(quotaLock) {
                if (stagingIdentities[identity] == handoffId) stagingIdentities.remove(identity)
            }
        }
    }

    private fun persistRejectedIntent(incoming: Intent, code: String) {
        val root = File(applicationInfo.dataDir, ROOT_NAME)
        val handoffId = UUID.randomUUID().toString()
        val identity = ShareHandoffPolicy.dedupeIdentity(
            incoming.action,
            incoming.type,
            incoming.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(),
            emptyList(),
        )
        val record = JSONObject()
            .put("handoff_id", handoffId)
            .put("received_at_ms", System.currentTimeMillis())
            .put("state", "interrupted")
            .put("identity", identity)
            .put("bound_profile_id", JSONObject.NULL)
            .put("error_code", code)
            .put("text", JSONObject.NULL)
            .put("text_state", "interrupted")
            .put("items", JSONArray())
        synchronized(quotaLock) {
            ensurePrivateRoot(root)
            writeAtomic(File(root, "$handoffId.json"), record.toString().toByteArray(Charsets.UTF_8))
            pruneContentFreeReceipts(root, handoffId)
        }
        launchMain(handoffId)
    }

    private fun launchMain(handoffId: String) {
        val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        launch.putExtra(EXTRA_HANDOFF_ID, handoffId)
        startActivity(launch)
    }

    private fun route(intent: Intent): ShareInput? {
        if (!ShareHandoffPolicy.accepts(intent.action)) return null
        val mime = intent.type?.lowercase()?.substringBefore(';') ?: ""
        val text = ShareHandoffPolicy.textPayload(
            intent.action,
            mime,
            intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(),
        )
        val uris = linkedSetOf<Uri>()
        if (intent.action == Intent.ACTION_SEND) {
            @Suppress("DEPRECATION")
            (intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri)?.let(uris::add)
        } else {
            @Suppress("DEPRECATION")
            (intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()).forEach(uris::add)
        }
        intent.clipData?.let { clip -> for (index in 0 until clip.itemCount) clip.getItemAt(index).uri?.let(uris::add) }
        val files = uris.filter { it.scheme == "content" }
        ShareHandoffPolicy.itemCountError(files.size)?.let { throw StageFailure(it) }
        if (text == null && files.isEmpty()) return null
        return ShareInput(text, files.map(::ShareFile))
    }

    private fun queryMetadata(file: ShareFile): ShareMetadata {
        var name = "Shared file"
        var size: Long? = null
        var cursor: Cursor? = null
        try {
            cursor = contentResolver.query(file.uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
            if (cursor?.moveToFirst() == true) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIndex >= 0) name = cursor.getString(nameIndex) ?: name
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex).takeIf { it >= 0 }
            }
        } finally { cursor?.close() }
        val mediaType = contentResolver.getType(file.uri) ?: "application/octet-stream"
        if (size != null && !ShareHandoffPolicy.acceptsBounds(size, size)) throw StageFailure("size_mismatch")
        return ShareMetadata(ShareHandoffPolicy.sanitizeName(name), ShareHandoffPolicy.sanitizeMime(mediaType), size)
    }

    private fun recover(root: File) {
        root.listFiles()?.filter { it.extension == "json" }?.forEach { file ->
            try {
                val record = JSONObject(file.readText(Charsets.UTF_8))
                val wasReceiving = record.optString("state") == "receiving"
                if (wasReceiving && BetaShareHandoffCancellation.isReceiving(record.optString("handoff_id"))) return@forEach
                if (wasReceiving) {
                    record.put("state", "interrupted").put("error_code", "interrupted")
                }
                val items = record.optJSONArray("items") ?: JSONArray()
                var changed = wasReceiving
                for (index in 0 until items.length()) {
                    val item = items.getJSONObject(index)
                    val itemState = item.optString("state")
                    if (itemState == "receiving" || itemState == "interrupted" || itemState == "cancelled") {
                        removePrivateStagingFile(root, item.optString("item_id"), "part")
                        removePrivateStagingFile(root, item.optString("item_id"), "bin")
                    }
                    if (wasReceiving && itemState == "receiving") {
                        item.put("state", "interrupted").put("error_code", "interrupted")
                        changed = true
                    }
                }
                if (changed) {
                    record.put("items", items)
                    writeAtomic(file, record.toString().toByteArray(Charsets.UTF_8))
                }
            } catch (_: Exception) { /* malformed private records remain quarantined */ }
        }
        pruneContentFreeReceipts(root, "")
    }

    private fun deleteCurrentItemFiles(root: File, item: JSONObject) {
        val id = item.optString("item_id")
        removePrivateStagingFile(root, id, "part")
        removePrivateStagingFile(root, id, "bin")
    }

    private fun removePrivateStagingFile(root: File, rawItemId: String, extension: String) {
        val itemId = try { UUID.fromString(rawItemId).toString() } catch (_: Exception) { return }
        if (itemId != rawItemId) return
        val target = File(root, "$itemId.$extension")
        val metadata = runCatching { Os.lstat(target.absolutePath) }.getOrNull() ?: return
        if (OsConstants.S_ISREG(metadata.st_mode)) runCatching { Os.remove(target.absolutePath) }
    }

    private fun readDeduped(root: File, identity: String): String? = try {
        val record = JSONObject(File(root, "dedupe-$identity.json").readText(Charsets.UTF_8))
        val age = System.currentTimeMillis() - record.optLong("created_at_ms")
        val id = record.optString("handoff_id")
        val handoff = File(root, "$id.json")
        if (age in 0..DEDUPE_WINDOW_MS && UUID.fromString(id).toString() == id && handoff.isFile && JSONObject(handoff.readText(Charsets.UTF_8)).optString("state") == "ready") id else null
    } catch (_: Exception) { null }

    private fun writeDeduped(root: File, identity: String, handoffId: String) {
        writeAtomic(File(root, "dedupe-$identity.json"), JSONObject().put("handoff_id", handoffId).put("created_at_ms", System.currentTimeMillis()).toString().toByteArray(Charsets.UTF_8))
    }

    private fun pendingUsage(root: File): Pair<Int, Long> {
        var handoffs = 0
        var bytes = 0L
        val files = root.listFiles() ?: return fullQuotaUsage()
        for (file in files) {
            if (file.extension != "json") continue
            val rawId = file.nameWithoutExtension
            val id = runCatching { UUID.fromString(rawId).toString() }.getOrNull() ?: continue // dedupe journal
            if (id != rawId) return fullQuotaUsage()
            val metadata = runCatching { Os.lstat(file.absolutePath) }.getOrNull()
                ?: return fullQuotaUsage()
            if (!OsConstants.S_ISREG(metadata.st_mode)) return fullQuotaUsage()
            val record = runCatching { JSONObject(file.readText(Charsets.UTF_8)) }.getOrNull()
                ?: return fullQuotaUsage()
            val textState = record.optString("text_state")
            val textValue = record.opt("text")
            val items = record.optJSONArray("items") ?: JSONArray()
            if (record.optString("error_code") == "quota_exceeded"
                && record.optString("state") == "interrupted"
                && (textValue == null || textValue == JSONObject.NULL)
                && items.length() == 0) continue
            if (textState !in setOf("none", "receiving", "ready", "interrupted", "cancelled", "acknowledged")) {
                return fullQuotaUsage()
            }
            if (textState == "ready" && textValue !is String) return fullQuotaUsage()
            val pendingText = textState in setOf("ready", "receiving") && textValue is String
            val unacknowledgedItems = mutableListOf<JSONObject>()
            val cleanupItems = record.optJSONArray("cleanup_item_ids") ?: JSONArray()
            for (index in 0 until items.length()) {
                val item = runCatching { items.getJSONObject(index) }.getOrNull() ?: return fullQuotaUsage()
                if (item.optString("state") in setOf("ready", "receiving")) unacknowledgedItems.add(item)
            }
            val hasPending = ShareHandoffPolicy.hasPendingContent(
                record.optString("state"), textState, pendingText, unacknowledgedItems.map { it.optString("state") },
            ) || cleanupItems.length() > 0
            if (!hasPending) continue
            handoffs++
            if (pendingText) bytes = saturatingAdd(bytes, (textValue as String).toByteArray(Charsets.UTF_8).size.toLong())
            unacknowledgedItems.forEach { item ->
                val stored = saturatingAdd(
                    ownedFileBytes(root, item.optString("item_id"), "bin"),
                    ownedFileBytes(root, item.optString("item_id"), "part"),
                )
                val declared = item.optLong("byte_length", 0L).coerceAtLeast(0L)
                bytes = saturatingAdd(bytes, maxOf(stored, declared))
            }
            for (index in 0 until cleanupItems.length()) {
                val rawId = runCatching { cleanupItems.getString(index) }.getOrNull() ?: return fullQuotaUsage()
                bytes = saturatingAdd(bytes, ownedFileBytes(root, rawId, "bin"))
                bytes = saturatingAdd(bytes, ownedFileBytes(root, rawId, "part"))
            }
        }
        return handoffs to bytes
    }

    private fun fullQuotaUsage(): Pair<Int, Long> = Pair(Int.MAX_VALUE, Long.MAX_VALUE)

    private fun saturatingAdd(left: Long, right: Long): Long =
        if (right > Long.MAX_VALUE - left) Long.MAX_VALUE else left + right

    private fun ownedFileBytes(root: File, rawId: String, extension: String): Long {
        val id = runCatching { UUID.fromString(rawId).toString() }.getOrNull() ?: return 0L
        if (id != rawId) return 0L
        val file = File(root, "$id.$extension")
        val metadata = runCatching { Os.lstat(file.absolutePath) }.getOrNull() ?: return 0L
        return if (OsConstants.S_ISREG(metadata.st_mode)) metadata.st_size else 0L
    }

    private fun persistQuotaFailure(root: File, handoffId: String, identity: String) {
        val record = JSONObject()
            .put("handoff_id", handoffId)
            .put("received_at_ms", System.currentTimeMillis())
            .put("state", "interrupted")
            .put("identity", identity)
            .put("bound_profile_id", JSONObject.NULL)
            .put("error_code", "quota_exceeded")
            .put("text", JSONObject.NULL)
            .put("text_state", "interrupted")
            .put("items", JSONArray())
        writeAtomic(File(root, "$handoffId.json"), record.toString().toByteArray(Charsets.UTF_8))
        pruneContentFreeReceipts(root, handoffId)
    }

    private fun pruneContentFreeReceipts(root: File, keepId: String) {
        val candidates = mutableListOf<ShareHandoffPolicy.ContentFreeReceipt>()
        root.listFiles()?.filter { it.extension == "json" }?.forEach { file ->
            try {
                val metadata = Os.lstat(file.absolutePath)
                if (!OsConstants.S_ISREG(metadata.st_mode)) return@forEach
                val record = JSONObject(file.readText(Charsets.UTF_8))
                val id = record.optString("handoff_id")
                if (UUID.fromString(id).toString() != id || file.name != "$id.json") return@forEach
                val items = record.optJSONArray("items") ?: return@forEach
                val cleanupItems = record.optJSONArray("cleanup_item_ids")
                val cleanupValue = record.opt("cleanup_item_ids")
                val text = record.opt("text")
                val hasCleanupQueue = when {
                    cleanupValue == null || cleanupValue == JSONObject.NULL -> false
                    cleanupItems != null -> cleanupItems.length() > 0
                    else -> true
                }
                val receiptItems = (0 until items.length()).map { index ->
                    val item = items.getJSONObject(index)
                    val hash = item.opt("sha256")
                    ShareHandoffPolicy.ReceiptItem(
                        state = item.optString("state"),
                        byteLength = item.optLong("byte_length", -1L),
                        hasSha256 = hash != null && hash != JSONObject.NULL,
                    )
                }
                candidates += ShareHandoffPolicy.ContentFreeReceipt(
                    handoffId = id,
                    receivedAtMs = record.optLong("received_at_ms"),
                    state = record.optString("state"),
                    errorCode = record.optString("error_code"),
                    textState = record.optString("text_state"),
                    hasText = text != null && text != JSONObject.NULL,
                    items = receiptItems,
                    hasCleanupQueue = hasCleanupQueue,
                )
            } catch (_: Exception) { /* malformed records are never removed */ }
        }
        for (id in ShareHandoffPolicy.contentFreeReceiptIdsToPrune(candidates, keepId)) {
            removePrivateManifest(root, id)
        }
    }

    private fun removePrivateManifest(root: File, rawId: String) {
        val id = runCatching { UUID.fromString(rawId).toString() }.getOrNull() ?: return
        if (id != rawId) return
        val target = File(root, "$id.json")
        val metadata = runCatching { Os.lstat(target.absolutePath) }.getOrNull() ?: return
        if (OsConstants.S_ISREG(metadata.st_mode)) runCatching { Os.remove(target.absolutePath) }
    }

    private fun digestIdentity(intent: Intent, input: ShareInput): String {
        return ShareHandoffPolicy.dedupeIdentity(intent.action, intent.type, input.text, input.files.map { it.uri.toString() })
    }

    private fun checkCancelled(id: String) { if (BetaShareHandoffCancellation.isCancelled(id)) throw CancellationException("handoff cancelled") }
    private fun showReceiptPersistenceFallback() {
        Toast.makeText(this, ShareHandoffPolicy.RECEIPT_PERSISTENCE_FAILURE_MESSAGE, Toast.LENGTH_LONG).show()
    }
    private fun ensurePrivateRoot(root: File) {
        try {
            if (!root.exists() && !root.mkdirs()) throw ShareHandoffStorageFailure()
        } catch (_: Exception) {
            throw ShareHandoffStorageFailure()
        }
    }
    private fun writeAtomic(target: File, bytes: ByteArray) {
        try {
            val temporary = File(target.parentFile, "${target.name}.tmp")
            FileOutputStream(temporary).use { stream -> stream.write(bytes); stream.fd.sync() }
            Os.rename(temporary.absolutePath, target.absolutePath)
        } catch (_: Exception) {
            throw ShareHandoffStorageFailure()
        }
    }
    private fun classifyStageFailure(error: Exception): String = when (error) {
        is StageFailure -> error.code
        else -> ShareHandoffPolicy.errorCodeFor(error)
    }
    private data class ShareFile(val uri: Uri)
    private data class ShareInput(val text: String?, val files: List<ShareFile>)
    private data class ShareMetadata(val name: String, val mediaType: String, val size: Long?)
    private class StageFailure(val code: String) : Exception()

    companion object {
        const val EXTRA_HANDOFF_ID = "com.exomind.beta.SHARE_HANDOFF_ID"
        private const val TAG = "BetaShareHandoff"
        private const val ROOT_NAME = "beta-share-handoffs"
        private const val COPY_BUFFER_BYTES = 64 * 1024
        private const val DEDUPE_WINDOW_MS = 10_000L
        private val executor = createShareHandoffExecutor()
        private val quotaLock = Any()
        private val stagingIdentities = mutableMapOf<String, String>()
    }
}

private fun ByteArray.toHex(): String = joinToString("") { byte -> "%02x".format(byte) }
