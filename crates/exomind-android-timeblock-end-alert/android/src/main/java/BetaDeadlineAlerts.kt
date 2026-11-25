package app.tauri.exomindtimeblockendalert

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import app.tauri.plugin.JSObject
import org.json.JSONObject
import java.util.UUID

internal data class BetaDeadlineStoredNotificationText(
  val blockName: String,
  val blockNote: String,
)

/** Delivered IDs retain their receipt/scope metadata, not user-authored text. */
internal fun betaDeadlineStoredNotificationText(
  blockName: String,
  blockNote: String,
  delivered: Boolean,
): BetaDeadlineStoredNotificationText? =
  if (delivered) null else BetaDeadlineStoredNotificationText(blockName, blockNote)

/** Beta-only namespace: Alpha's single-timer storage and intents stay intact.
 * Inputs are sealed Native projections, not JS-selected scheduler authority.
 * Receiver effects are presentation only; Core owns every deadline fact.
 */
object BetaDeadlineAlerts {
  const val ACTION_FIRE = "com.exomind.app.action.BETA_DEADLINE_ALERT_FIRE"
  const val CHANNEL_ID = "exomind_beta_deadline_alert"
  private const val CHANNEL_NAME = "时间块到点"
  private const val CHANNEL_DESCRIPTION = "时间块倒计时到点时的系统提醒。"
  private const val MAX_RECEIPTS = 4096
  private val gate=BetaDeadlineGate()
  private var handoffFailure=false
  @Synchronized fun noteHandoffFailure() { handoffFailure=true }
  internal fun traceHandoff(stage:String,handoffId:String?=null,profileId:String?=null,blockId:String?=null,deadlineId:String?=null) {
    if(!stage.matches(Regex("[a-z_]{1,48}")))return
    fun safe(value:String?)=if(BetaHandoffPolicy.uuid(value))value else "none"
    // Diagnostic availability must not change commit/ACK/launch semantics.
    runCatching { Log.i("ExoMindBetaHandoff","stage=$stage handoff=${safe(handoffId)} profile=${safe(profileId)} block=${safe(blockId)} deadline=${safe(deadlineId)}") }
  }
  private fun prefs(context: Context) = context.getSharedPreferences("exomind.beta.deadline.alerts", Context.MODE_PRIVATE)
  private fun manager(context: Context) = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
  private fun exact(context: Context): Boolean = runCatching { manager(context)?.let { Build.VERSION.SDK_INT < Build.VERSION_CODES.S || it.canScheduleExactAlarms() } ?: false }.getOrDefault(false)
  private fun notificationChannel(context: Context): NotificationChannel? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    return context.getSystemService(NotificationManager::class.java)?.getNotificationChannel(CHANNEL_ID)
  }

  private fun ensureNotificationChannel(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
    val notifications = context.getSystemService(NotificationManager::class.java) ?: return false
    val existing = notifications.getNotificationChannel(CHANNEL_ID)
    val defaultSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
    val policy = deadlineNotificationSoundPolicy(
      channelSupported = true,
      channelAlreadyExists = existing != null,
      defaultSoundAvailable = defaultSound != null,
    )
    if (!policy.createChannel) return true

    return runCatching {
      val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
        description = CHANNEL_DESCRIPTION
        setShowBadge(false)
        if (policy.applyDefaultSystemSoundToNewChannel) {
          setSound(
            defaultSound,
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_NOTIFICATION)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build(),
          )
        }
      }
      notifications.createNotificationChannel(channel)
      true
    }.onFailure { error ->
      Log.w("ExoMindBetaDeadline", "notification channel requires system settings review", error)
    }.getOrDefault(false)
  }

  private fun channelImportanceLabel(channel: NotificationChannel?): String = when (channel?.importance) {
    null -> "unavailable"
    NotificationManager.IMPORTANCE_NONE -> "blocked"
    NotificationManager.IMPORTANCE_MIN -> "min"
    NotificationManager.IMPORTANCE_LOW -> "low"
    NotificationManager.IMPORTANCE_DEFAULT -> "default"
    NotificationManager.IMPORTANCE_HIGH -> "high"
    NotificationManager.IMPORTANCE_MAX -> "max"
    else -> "unknown"
  }

  fun notificationChannelState(context: Context, permission: String): JSObject {
    val channelSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
    val channel = notificationChannel(context)
    val soundEnabled = channel?.let {
      deadlineChannelSoundEnabled(
        channelExists = true,
        channelBlocked = it.importance == NotificationManager.IMPORTANCE_NONE,
        soundUriPresent = it.sound != null,
      )
    }
    return JSObject()
      .put("notificationPermission", permission)
      .put("notificationsEnabled", NotificationManagerCompat.from(context).areNotificationsEnabled())
      .put("channelSupported", channelSupported)
      .put("channelExists", channel != null)
      .put("channelImportance", channelImportanceLabel(channel))
      .put("channelSoundEnabled", soundEnabled ?: JSONObject.NULL)
      .put("settingsAvailable", true)
  }

  fun openNotificationChannelSettings(activity: android.app.Activity) {
    check(ensureNotificationChannel(activity.applicationContext)) { "notification channel unavailable" }
    val channelSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
    val intent = if (channelSupported) {
      Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
        .putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL_ID)
    } else {
      Intent(Settings.ACTION_SOUND_SETTINGS)
    }
    activity.startActivity(intent)
  }

  private fun notificationAllowed(context: Context): Boolean {
    val notifications=NotificationManagerCompat.from(context)
    return notifications.areNotificationsEnabled() && (Build.VERSION.SDK_INT<Build.VERSION_CODES.O || notifications.getNotificationChannel(CHANNEL_ID)?.importance!=NotificationManager.IMPORTANCE_NONE)
  }
  private fun load(context: Context): JSONObject = JSONObject(prefs(context).getString("alerts", "{}") ?: "{}")
  private fun receipts(context: Context): MutableSet<String> = (prefs(context).getStringSet("delivered", emptySet()) ?: emptySet()).toMutableSet()
  private fun scopes(context: Context): JSONObject = JSONObject(prefs(context).getString("delivered_scopes","{}") ?: "{}")
  private fun pending(context: Context):JSONObject? {
    val encoded=prefs(context).getString("pending_handoff",null) ?: return null
    require(encoded.length<=512) { "invalid handoff state" }
    val value=JSONObject(encoded)
    require(value.keys().asSequence().toSet()==setOf("handoffId","profileId","blockId","deadlineId") && BetaHandoffPolicy.uuid(value.optString("handoffId"))) { "invalid handoff state" }
    val id=value.optString("deadlineId");val known=scopes(context).optJSONObject(id)
    require(BetaHandoffPolicy.accepts(receipts(context).contains(id),known?.optString("profile"),known?.optString("block"),value.optString("profileId"),value.optString("blockId"),id)) { "unknown handoff source" }
    return value
  }
  private fun save(context: Context, alerts: JSONObject) {
    check(prefs(context).edit().putString("alerts", alerts.toString()).commit()) { "deadline alert persistence failed" }
  }
  private fun alarm(context: Context, id: String): PendingIntent = PendingIntent.getBroadcast(context, 0,
    Intent(context, TimeblockEndAlertReceiver::class.java).apply { action=ACTION_FIRE;data=Uri.parse("exomind-beta://deadline/$id") },
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

  @Synchronized
  fun activate(context: Context, token: String) {
    ensureNotificationChannel(context)
    val old=load(context)
    // Preserve source attribution for already posted notifications across a
    // new Native runtime, including migration from the earlier UUID-only set.
    val known=scopes(context);val delivered=receipts(context)
    old.keys().asSequence().filter { delivered.contains(it) }.forEach { id ->
      val entry=old.getJSONObject(id)
      known.put(id,JSONObject().put("profile",entry.getString("profile")).put("block",entry.getString("block")))
    }
    require(known.length()<=MAX_RECEIPTS) { "deadline source capacity" }
    check(prefs(context).edit().putString("delivered_scopes",known.toString()).commit()) { "deadline source persistence failed" }
    gate.activate(token)
    save(context,JSONObject())
    old.keys().asSequence().toList().forEach { manager(context)?.cancel(alarm(context,it)) }
  }

  @Synchronized
  fun sync(context: Context, input: List<BetaDeadlineAlertArgs>, token: String, expiresAt: Long, acknowledgeHandoffId:String?=null, preserveAlerts:Boolean=false): JSObject {
    gate.check(token,expiresAt,SystemClock.elapsedRealtime())
    if(!preserveAlerts) syncAlerts(context,input,token,expiresAt)
    gate.check(token,expiresAt,SystemClock.elapsedRealtime())
    check(!handoffFailure) { "notification handoff persistence requires recovery" }
    val currentPending=pending(context)
    val acknowledged=if(BetaHandoffPolicy.acknowledge(currentPending?.optString("handoffId"),acknowledgeHandoffId)) {
      check(prefs(context).edit().remove("pending_handoff").commit()) { "handoff acknowledgement persistence failed" }
      traceHandoff("ack_committed",handoffId=acknowledgeHandoffId)
      acknowledgeHandoffId
    }else null
    val current=receipts(context);val entries=load(context)
    val ids=entries.keys().asSequence().toList();val now=SystemClock.elapsedRealtime()
    return JSObject().put("notificationPermission",if(notificationAllowed(context))"granted" else "denied")
      .put("exactAlarm",exact(context)).put("scheduledCount",ids.count { !current.contains(it) && !entries.getJSONObject(it).optBoolean("completed") && entries.getJSONObject(it).getLong("trigger")>now })
      .put("deliveredCount",ids.count { current.contains(it) }).put("pendingHandoff",pending(context) ?: JSONObject.NULL)
      .put("acknowledgedHandoffId",acknowledged ?: JSONObject.NULL)
  }
  private fun syncAlerts(context:Context,input:List<BetaDeadlineAlertArgs>,token:String,expiresAt:Long) {
    gate.capacity(input.size)
    val seen=mutableSetOf<String>()
    input.forEach {
      require(UUID.fromString(it.deadlineId).toString()==it.deadlineId && seen.add(it.deadlineId))
      require(UUID.fromString(it.profileId).toString()==it.profileId && UUID.fromString(it.blockId).toString()==it.blockId)
      require(it.dueAt>0 && it.remainingMs>=0)
      require(BetaDeadlineNotificationText.isValidProjection(it.blockName,it.blockNote)) { "invalid deadline notification text" }
    }
    val delivered=receipts(context)
    gate.receiptCapacity(delivered.size,seen.count { !delivered.contains(it) })
    val old=load(context);val next=JSONObject();val now=SystemClock.elapsedRealtime()
    input.forEach { a ->
      val previous=old.optJSONObject(a.deadlineId)
      val trigger=if(a.completed) now else now+minOf(a.remainingMs, Long.MAX_VALUE-now)
      // Repeated snapshots must not postpone a timer or recreate delivered IDs.
      val oldTrigger=previous?.optLong("trigger", -1) ?: -1
      val same=previous!=null && previous.optString("profile")==a.profileId && previous.optString("block")==a.blockId && !a.completed && kotlin.math.abs(oldTrigger-trigger)<500
      val storedText=betaDeadlineStoredNotificationText(a.blockName,a.blockNote,delivered.contains(a.deadlineId))
      val entry=JSONObject().put("profile",a.profileId).put("block",a.blockId).put("due",a.dueAt).put("completed",a.completed).put("trigger",if(same)oldTrigger else trigger)
      storedText?.let { entry.put("blockName",it.blockName).put("blockNote",it.blockNote) }
      next.put(a.deadlineId,entry)
    }
    gate.check(token,expiresAt,SystemClock.elapsedRealtime())
    save(context,next)
    old.keys().asSequence().toList().filter { !next.has(it) }.forEach { manager(context)?.cancel(alarm(context,it)) }
    input.forEach { a ->
      gate.check(token,expiresAt,SystemClock.elapsedRealtime())
      if(delivered.contains(a.deadlineId)) { manager(context)?.cancel(alarm(context,a.deadlineId));return@forEach }
      val entry=next.getJSONObject(a.deadlineId)
      if(a.completed || a.remainingMs==0L) { fire(context,a.deadlineId);return@forEach }
      schedule(context,a.deadlineId,entry.getLong("trigger"))
    }
  }
  @Synchronized
  fun recordHandoff(context:Context,intent:Intent?):Boolean {
    val uri=intent?.data ?: run { traceHandoff("tap_missing_marker");return false }
    if(uri.scheme!="exomind-beta" || uri.host!="open-deadline" || uri.pathSegments.size!=1 || uri.port!=-1 || uri.query!=null || uri.fragment!=null){traceHandoff("tap_invalid_marker");return false}
    val id=uri.lastPathSegment ?: return false
    val profile=intent.getStringExtra("betaProfileId");val block=intent.getStringExtra("betaBlockId")
    val known=scopes(context).optJSONObject(id)
    if(!BetaHandoffPolicy.accepts(receipts(context).contains(id),known?.optString("profile"),known?.optString("block"),profile,block,id)){traceHandoff("tap_unknown_source",profileId=profile,blockId=block,deadlineId=id);return false}
    // Latest explicit tap wins the one durable slot. Old ACKs cannot clear it.
    val handoff=JSONObject().put("handoffId",UUID.randomUUID().toString()).put("profileId",profile).put("blockId",block).put("deadlineId",id)
    check(prefs(context).edit().putString("pending_handoff",handoff.toString()).commit()) { "notification handoff persistence failed" }
    traceHandoff("tap_committed",handoffId=handoff.getString("handoffId"),profileId=profile,blockId=block,deadlineId=id)
    handoffFailure=false
    // Ordinary Activity recreation must not manufacture a fresh handoff.
    intent.data=null;intent.removeExtra("betaProfileId");intent.removeExtra("betaBlockId")
    traceHandoff("tap_markers_consumed",handoffId=handoff.getString("handoffId"),profileId=profile,blockId=block,deadlineId=id)
    return true
  }
  private fun schedule(context: Context,id:String,trigger:Long) {
    val alarms=manager(context) ?: throw IllegalStateException("alarm manager unavailable")
    if(exact(context)) {
      try { alarms.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,trigger,alarm(context,id));return }
      catch (_: SecurityException) { /* capability may change between query and set */ }
    }
    alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,trigger,alarm(context,id))
  }
  @Synchronized
  fun fire(context: Context,id:String) {
    val alerts=load(context)
    val entry=alerts.optJSONObject(id) ?: return
    val delivered=receipts(context)
    if(delivered.contains(id) || delivered.size>=MAX_RECEIPTS)return
    val now=SystemClock.elapsedRealtime()
    if(!entry.optBoolean("completed") && entry.getLong("trigger")>now) { schedule(context,id,entry.getLong("trigger"));return }
    if (!ensureNotificationChannel(context)) return
    val notifications=NotificationManagerCompat.from(context)
    if(!notificationAllowed(context))return
    val launch=Intent(context,BetaDeadlineHandoffActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    // Scope extras are hints for presentation, never Core commands or authority.
    launch.putExtra("betaProfileId",entry.getString("profile")).putExtra("betaBlockId",entry.getString("block"))
    launch.data=Uri.parse("exomind-beta://open-deadline/$id")
    val open=PendingIntent.getActivity(context,0,launch,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val channelSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
    val defaultSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
    val soundPolicy = deadlineNotificationSoundPolicy(
      channelSupported = channelSupported,
      channelAlreadyExists = notificationChannel(context) != null,
      defaultSoundAvailable = defaultSound != null,
    )
    val notificationText=BetaDeadlineNotificationText.content(
      entry.optString("blockName", ""),
      entry.optString("blockNote", ""),
    )
    val builder = NotificationCompat.Builder(context,CHANNEL_ID).setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(notificationText.title).setContentText(notificationText.body)
      .setCategory(NotificationCompat.CATEGORY_REMINDER).setPriority(NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setContentIntent(open).setAutoCancel(true)
    if (soundPolicy.applyDefaultSystemSoundToLegacyNotification) {
      defaultSound?.let { builder.setSound(it, AudioManager.STREAM_NOTIFICATION) }
    }
    val notification=builder.build()
    try {
      notifications.notify("beta-deadline-$id",0,notification)
      delivered.add(id)
      val known=scopes(context)
      known.put(id,JSONObject().put("profile",entry.getString("profile")).put("block",entry.getString("block")))
      require(known.length()<=MAX_RECEIPTS) { "deadline source capacity" }
      if (betaDeadlineStoredNotificationText(
        entry.optString("blockName", ""),
        entry.optString("blockNote", ""),
        delivered = true,
      ) == null) {
        entry.remove("blockName")
        entry.remove("blockNote")
      }
      check(prefs(context).edit()
        .putString("alerts",alerts.toString())
        .putStringSet("delivered",delivered)
        .putString("delivered_scopes",known.toString())
        .commit()) { "deadline receipt persistence failed" }
    } catch (_: SecurityException) { return }
    manager(context)?.cancel(alarm(context,id))
  }
  @Synchronized
  fun rescheduleAfterBoot(context: Context) {
    val alerts=load(context);val delivered=receipts(context);val wall=System.currentTimeMillis();val elapsed=SystemClock.elapsedRealtime()
    alerts.keys().asSequence().toList().forEach { id ->
      val entry=alerts.getJSONObject(id)
      entry.put("trigger",elapsed+maxOf(0L,entry.getLong("due")-wall))
    }
    save(context,alerts)
    alerts.keys().asSequence().toList().filter { !delivered.contains(it) }.forEach { id ->
      val entry=alerts.getJSONObject(id)
      if(entry.optBoolean("completed") || entry.getLong("trigger")<=elapsed)fire(context,id) else schedule(context,id,entry.getLong("trigger"))
    }
  }
}
