package app.tauri.exomindtimeblockendalert
import java.util.UUID

internal object BetaHandoffPolicy {
  fun uuid(value:String?):Boolean=try { value!=null && UUID.fromString(value).toString()==value && value!="00000000-0000-0000-0000-000000000000" }catch (_:IllegalArgumentException){false}
  fun accepts(delivered:Boolean,knownProfile:String?,knownBlock:String?,profile:String?,block:String?,deadline:String?):Boolean =
    delivered && uuid(profile) && uuid(block) && uuid(deadline) && knownProfile==profile && knownBlock==block
  fun acknowledge(current:String?,requested:String?):Boolean = uuid(requested) && current==requested
}
