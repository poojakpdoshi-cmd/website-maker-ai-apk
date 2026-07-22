package ai.nexora.nativeapp.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SessionStore(context: Context) {
    private val preferences = context.getSharedPreferences(
        "nexora_native_session",
        Context.MODE_PRIVATE
    )

    private val keyAlias = "nexora_session_aes_v1"

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply {
            load(null)
        }

        (keyStore.getKey(keyAlias, null) as? SecretKey)?.let {
            return it
        }

        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        )

        generator.init(
            KeyGenParameterSpec.Builder(
                keyAlias,
                KeyProperties.PURPOSE_ENCRYPT or
                    KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(
                    KeyProperties.ENCRYPTION_PADDING_NONE
                )
                .setKeySize(256)
                .build()
        )

        return generator.generateKey()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())

        val encrypted = cipher.doFinal(
            value.toByteArray(Charsets.UTF_8)
        )

        val combined = cipher.iv + encrypted

        return "enc:" + Base64.encodeToString(
            combined,
            Base64.NO_WRAP
        )
    }

    private fun decrypt(value: String): String? {
        if (!value.startsWith("enc:")) {
            return value
        }

        return runCatching {
            val combined = Base64.decode(
                value.removePrefix("enc:"),
                Base64.NO_WRAP
            )

            require(combined.size > 12)

            val iv = combined.copyOfRange(0, 12)
            val encrypted = combined.copyOfRange(
                12,
                combined.size
            )

            val cipher = Cipher.getInstance(
                "AES/GCM/NoPadding"
            )

            cipher.init(
                Cipher.DECRYPT_MODE,
                secretKey(),
                GCMParameterSpec(128, iv)
            )

            cipher.doFinal(encrypted)
                .toString(Charsets.UTF_8)
        }.getOrNull()
    }

    private fun saveSecret(name: String, value: String) {
        preferences.edit()
            .putString(name, encrypt(value))
            .apply()
    }

    private fun readSecret(name: String): String? {
        val stored = preferences.getString(name, null)
            ?: return null
        val decrypted = decrypt(stored) ?: return null

        if (!stored.startsWith("enc:")) {
            saveSecret(name, decrypted)
        }

        return decrypted
    }

    fun save(token: String, username: String, email: String) {
        saveSecret("token", token)

        preferences.edit()
            .putString("username", username)
            .putString("email", email)
            .apply()
    }

    fun token(): String? = readSecret("token")
    fun username(): String? =
        preferences.getString("username", null)
    fun email(): String? =
        preferences.getString("email", null)

    fun saveAdminToken(token: String) {
        saveSecret("admin_token", token)
    }

    fun adminToken(): String? = readSecret("admin_token")

    fun saveChatHistory(messages: List<Pair<String, String>>) {
        val history = JSONArray()
        val selected = mutableListOf<Pair<String, String>>()
        var storedCharacters = 0

        messages.asReversed().take(60).forEach { (role, rawText) ->
            val safeRole = when (role) {
                "user" -> "user"
                "assistant" -> "assistant"
                else -> return@forEach
            }

            if (storedCharacters >= 300_000) {
                return@forEach
            }

            val text = rawText
                .trim()
                .take(16_000)
                .take(300_000 - storedCharacters)

            if (text.isBlank()) {
                return@forEach
            }

            storedCharacters += text.length
            selected += safeRole to text
        }

        selected.asReversed().forEach { (role, text) ->
            history.put(
                JSONObject()
                    .put("role", role)
                    .put("text", text)
            )
        }

        saveSecret("chat_history_v1", history.toString())
    }

    fun chatHistory(): List<Pair<String, String>> {
        val raw = readSecret("chat_history_v1")
            ?: return emptyList()

        return runCatching {
            val history = JSONArray(raw)

            buildList {
                for (index in 0 until history.length()) {
                    val item = history.optJSONObject(index)
                        ?: continue
                    val role = item.optString("role")
                    val text = item.optString("text")

                    if (
                        (role == "user" || role == "assistant") &&
                        text.isNotBlank()
                    ) {
                        add(role to text.take(16_000))
                    }
                }
            }.takeLast(60)
        }.getOrDefault(emptyList())
    }

    fun clearChatHistory() {
        preferences.edit()
            .remove("chat_history_v1")
            .apply()
    }

    fun clearAdmin() {
        preferences.edit().remove("admin_token").apply()
    }

    fun installationId(): String {
        val existing = preferences.getString(
            "installation_id",
            null
        )

        if (!existing.isNullOrBlank()) {
            return existing
        }

        val created = UUID.randomUUID().toString()
        preferences.edit()
            .putString("installation_id", created)
            .apply()
        return created
    }

    fun clear() {
        preferences.edit()
            .remove("token")
            .remove("username")
            .remove("email")
            .remove("chat_history_v1")
            .apply()
    }
}
