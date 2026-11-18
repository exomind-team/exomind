package app.tauri.exomindclipboard

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.ClipData
import android.webkit.MimeTypeMap
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.UUID

@InvokeArg
class OpenFileArgs {
    lateinit var path: String
    lateinit var mediaType: String
}

/** Reads only the current system clipboard's content URI, never arbitrary URLs. */
@TauriPlugin
class ClipboardImagePlugin(private val activity: Activity) : Plugin(activity) {
    private val reader = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)
    private val destroyed = AtomicBoolean(false)

    @Command
    fun readFiles(invoke: Invoke) {
        if (!busy.compareAndSet(false, true)) { invoke.reject("正在读取剪贴板，请稍候"); return }
        activity.runOnUiThread {
            try {
                check(!destroyed.get() && activity.hasWindowFocus())
                val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = clipboard.primaryClip
                val uris = (0 until (clip?.itemCount ?: 0)).mapNotNull { clip?.getItemAt(it)?.uri }.filter { it.scheme == "content" || it.scheme == "file" }.distinct()
                require(uris.size <= 128)
                if (uris.isEmpty()) { busy.set(false); invoke.resolve(JSObject().put("files", JSONArray())); return@runOnUiThread }
                reader.execute {
                    val owned = mutableListOf<File>()
                    val directory = File(activity.cacheDir, "beta-clipboard/${UUID.randomUUID()}")
                    try {
                        check(directory.mkdirs())
                        val files = JSONArray()
                        for ((index, uri) in uris.withIndex()) {
                            val resolver = activity.contentResolver
                            val displayName = if (uri.scheme == "file") File(uri.path ?: "").name else resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null } ?: "剪贴板附件-${index + 1}"
                            val mediaType = resolver.getType(uri) ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(File(displayName).extension.lowercase()) ?: "application/octet-stream"
                            val safeName = File(displayName).name.ifBlank { "attachment-$index" }
                            val destination = File(directory, "$index-$safeName")
                            owned.add(destination)
                            resolver.openInputStream(uri)?.use { input -> destination.outputStream().use { output ->
                                val buffer = ByteArray(64 * 1024);var length = 0L
                                while (true) { check(!destroyed.get() && !Thread.currentThread().isInterrupted);val count = input.read(buffer);if (count < 0) break;length += count;require(length <= 4L * 1024 * 1024 * 1024);output.write(buffer, 0, count) }
                                output.fd.sync()
                            } } ?: throw IllegalStateException()
                            files.put(JSObject().put("path", destination.absolutePath).put("fileName", displayName).put("mediaType", mediaType))
                        }
                        check(!destroyed.get())
                        invoke.resolve(JSObject().put("files", files))
                    } catch (_: Exception) {
                        owned.forEach { it.delete() };directory.delete()
                        invoke.reject("无法读取剪贴板文件，请检查读取权限、空间或重新复制")
                    } finally { busy.set(false) }
                }
            } catch (_: Exception) { busy.set(false);invoke.reject("请在当前窗口重新复制并粘贴文件") }
        }
    }

    @Command
    fun openFile(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                val args = invoke.parseArgs(OpenFileArgs::class.java)
                val file = File(args.path).canonicalFile
                val root = File(activity.cacheDir, "beta-open").canonicalFile
                require(file.isFile && file.path.startsWith(root.path + File.separator))
                val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.beta.originals", file)
                val inferred = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase())
                val mediaType = if (args.mediaType == "application/octet-stream") inferred ?: "*/*" else args.mediaType
                val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mediaType)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                view.clipData = ClipData.newRawUri("原件", uri)
                activity.startActivity(Intent.createChooser(view, "打开方式").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                invoke.resolve(JSObject().put("opened", true))
            } catch (_: Exception) {
                invoke.reject("系统无法打开此格式，请安装相应应用或另存为后打开")
            }
        }
    }

    @Command
    fun readImage(invoke: Invoke) {
        if (!busy.compareAndSet(false, true)) {
            invoke.reject("正在读取剪贴板图片，请稍候")
            return
        }
        activity.runOnUiThread {
            try {
                check(!destroyed.get() && activity.hasWindowFocus())
                val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = clipboard.primaryClip
                val uri = if (clip != null && clip.itemCount > 0) clip.getItemAt(0).uri else null
                if (uri == null || uri.scheme != "content") {
                    busy.set(false)
                    invoke.resolve(JSObject().put("image", JSONObject.NULL))
                    return@runOnUiThread
                }
                reader.execute {
                    try {
                        val resolver = activity.contentResolver
                        val mediaType = resolver.getType(uri)?.lowercase()
                        val extension = when (mediaType) {
                            "image/png" -> "png"
                            "image/jpeg" -> "jpg"
                            "image/webp" -> "webp"
                            "image/gif" -> "gif"
                            "image/avif" -> "avif"
                            else -> throw IllegalArgumentException()
                        }
                        val bytes = resolver.openInputStream(uri)?.use { input ->
                            val output = ByteArrayOutputStream()
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                check(!destroyed.get() && !Thread.currentThread().isInterrupted)
                                val count = input.read(buffer)
                                if (count < 0) break
                                require(output.size() + count <= MAX_BYTES)
                                output.write(buffer, 0, count)
                            }
                            output.toByteArray()
                        } ?: throw IllegalStateException()
                        check(bytes.isNotEmpty() && !destroyed.get())
                        invoke.resolve(JSObject().put("image", JSObject()
                            .put("mediaType", mediaType)
                            .put("fileName", "clipboard-${System.currentTimeMillis()}.$extension")
                            .put("dataBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))))
                    } catch (_: Exception) {
                        invoke.reject("无法读取剪贴板图片（上限 16 MiB），请重新复制或使用附件选择")
                    } finally {
                        busy.set(false)
                    }
                }
            } catch (_: Exception) {
                busy.set(false)
                invoke.reject("请在当前窗口重新复制并粘贴图片")
            }
        }
    }

    override fun onDestroy() {
        destroyed.set(true)
        reader.shutdownNow()
        super.onDestroy()
    }

    companion object { private const val MAX_BYTES = 16 * 1024 * 1024 }
}
