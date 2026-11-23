package app.tauri.exomindsharehandoff

import android.app.Activity
import android.content.Intent
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.InputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

internal fun canonicalShareHandoffId(value: String?): String? {
    if (value.isNullOrBlank()) return null
    return runCatching {
        java.util.UUID.fromString(value).toString().takeIf { it == value }
    }.getOrNull()
}

@InvokeArg
class CancelReceivingArgs {
    lateinit var handoffId: String
}

/** Bridges a Native cancel request to the exact stream owned by its receiver. */
@TauriPlugin
class ShareHandoffPlugin(private val activity: Activity) : Plugin(activity) {
    /**
     * A share receiver can return to an already-running singleTask MainActivity.
     * Android then delivers a new intent instead of restarting the Tauri process;
     * announce the persisted handoff explicitly so the mounted WebView refreshes.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val handoffId = canonicalShareHandoffId(
            intent.getStringExtra(BetaShareHandoffActivity.EXTRA_HANDOFF_ID),
        ) ?: return
        trigger(
            "beta-share-handoff-available",
            JSObject().put("handoff_id", handoffId),
        )
    }

    @Command
    fun cancelReceiving(invoke: Invoke) {
        val args = invoke.parseArgs(CancelReceivingArgs::class.java)
        val validId = runCatching { java.util.UUID.fromString(args.handoffId).toString() == args.handoffId }.getOrDefault(false)
        if (!validId) {
            invoke.reject("Invalid handoff identity")
            return
        }
        invoke.resolve(JSObject().put("cancelled", BetaShareHandoffCancellation.cancel(args.handoffId)))
    }

    @Command
    fun isReceiving(invoke: Invoke) {
        val args = invoke.parseArgs(CancelReceivingArgs::class.java)
        val validId = runCatching { java.util.UUID.fromString(args.handoffId).toString() == args.handoffId }.getOrDefault(false)
        if (!validId) { invoke.reject("Invalid handoff identity"); return }
        invoke.resolve(JSObject().put("receiving", BetaShareHandoffCancellation.isReceiving(args.handoffId)))
    }
}

object BetaShareHandoffCancellation {
    private class ActiveCopy {
        val cancelled = AtomicBoolean(false)
        val completed = AtomicBoolean(false)
        var input: InputStream? = null
        var cancelOpen: (() -> Unit)? = null
    }

    private val active = ConcurrentHashMap<String, ActiveCopy>()

    fun begin(handoffId: String) { active[handoffId] = ActiveCopy() }

    fun open(
        handoffId: String,
        cancelOpen: () -> Unit,
        opener: () -> InputStream?,
    ): InputStream? {
        val copy = active[handoffId] ?: throw IllegalStateException("handoff no longer active")
        synchronized(copy) {
            if (copy.cancelled.get() || active[handoffId] !== copy) {
                throw java.util.concurrent.CancellationException("handoff cancelled")
            }
            copy.cancelOpen = cancelOpen
        }
        val opened = try {
            opener()
        } catch (error: Exception) {
            val cancelled = synchronized(copy) {
                if (copy.cancelOpen === cancelOpen) copy.cancelOpen = null
                copy.cancelled.get() || active[handoffId] !== copy
            }
            if (cancelled) throw java.util.concurrent.CancellationException("handoff cancelled")
            throw error
        }
        if (opened == null) {
            val cancelled = synchronized(copy) {
                if (copy.cancelOpen === cancelOpen) copy.cancelOpen = null
                copy.cancelled.get() || active[handoffId] !== copy
            }
            if (cancelled) throw java.util.concurrent.CancellationException("handoff cancelled")
            return null
        }
        val cancelled = synchronized(copy) {
            if (copy.cancelled.get() || active[handoffId] !== copy) {
                true
            } else {
                copy.cancelOpen = null
                copy.input = opened
                false
            }
        }
        if (cancelled) {
            try { opened.close() } catch (_: Exception) { }
            throw java.util.concurrent.CancellationException("handoff cancelled")
        }
        return opened
    }

    fun isCancelled(handoffId: String): Boolean = active[handoffId]?.cancelled?.get() ?: true

    fun isReceiving(handoffId: String): Boolean = active.containsKey(handoffId)

    fun detach(handoffId: String, input: InputStream) {
        val copy = active[handoffId] ?: return
        synchronized(copy) {
            if (copy.input === input) copy.input = null
        }
    }

    fun cancel(handoffId: String): Boolean {
        val copy = active[handoffId] ?: return false
        val cancellation = synchronized(copy) {
            if (copy.completed.get()) return false
            copy.cancelled.set(true)
            val action = copy.cancelOpen
            copy.cancelOpen = null
            val input = copy.input
            copy.input = null
            action to input
        }
        try { cancellation.first?.invoke() } catch (_: Exception) { }
        try { cancellation.second?.close() } catch (_: Exception) { }
        return true
    }

    fun complete(handoffId: String): Boolean {
        val copy = active[handoffId] ?: return false
        synchronized(copy) {
            if (copy.cancelled.get()) return false
            copy.completed.set(true)
            return true
        }
    }

    fun finish(handoffId: String) { active.remove(handoffId) }
}
