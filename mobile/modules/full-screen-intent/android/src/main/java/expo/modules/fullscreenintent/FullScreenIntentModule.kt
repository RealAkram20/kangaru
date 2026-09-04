package expo.modules.fullscreenintent

import android.app.NotificationManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads whether this app may take over a locked screen (ADR-0049 §2).
 *
 * `USE_FULL_SCREEN_INTENT` became a *special app access* in Android 14. A
 * dispatch app is installed without it and has to ask, and — the part that
 * makes this module necessary — Android does not refuse an ungranted
 * full-screen intent, it silently downgrades it to a heads-up banner. Nothing
 * in the JavaScript stack could tell the two apart: neither
 * `expo-notifications` nor `react-native-notify-kit` exposes the one platform
 * call that answers it, `NotificationManager.canUseFullScreenIntent()`.
 *
 * That single call is all this is. It exists so the app can stop asking a
 * driver who already said yes and keep asking one who has not.
 */
class FullScreenIntentModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FullScreenIntent")

    /**
     * `true` below Android 14, where the permission is granted at install and
     * there is nothing to read. On 14 and above, the platform's own answer.
     *
     * `null` when the notification manager cannot be reached, which is
     * "unreadable" and must not be reported as "refused" — telling a driver a
     * permission is denied when the app simply could not ask is the lie the
     * permissions screen exists to prevent.
     */
    Function("canUseFullScreenIntent") { ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        true
      } else {
        (appContext.reactContext?.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager)
          ?.canUseFullScreenIntent()
      }
    }
  }
}
