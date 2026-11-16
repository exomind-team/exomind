package app.tauri.exomindclipboard

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Reads only the current system clipboard's content URI, never arbitrary URLs. */
@TauriPlugin
class ClipboardImagePlugin(private val activity: Activity) : Plugin(activity) {
    private val reader = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)
    private val destroyed = AtomicBoolean(false)

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
