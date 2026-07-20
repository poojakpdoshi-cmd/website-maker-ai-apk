package ai.nexora.nativeapp.data

import android.content.Context

class SessionStore(context: Context) {
    private val preferences = context.getSharedPreferences(
        "nexora_native_session",
        Context.MODE_PRIVATE
    )

    fun save(token: String, username: String, email: String) {
        preferences.edit()
            .putString("token", token)
            .putString("username", username)
            .putString("email", email)
            .apply()
    }

    fun token(): String? = preferences.getString("token", null)
    fun username(): String? = preferences.getString("username", null)
    fun email(): String? = preferences.getString("email", null)

    fun clear() {
        preferences.edit().clear().apply()
    }
}
