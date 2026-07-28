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

data class ChatThread(
    val id: String,
    val title: String,
    val createdAt: Long,
    val updatedAt: Long,
    val messages: List<Pair<String, String>>
)

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

    private fun normalizeMessages(
        messages: List<Pair<String, String>>
    ): List<Pair<String, String>> {
        val selected = mutableListOf<Pair<String, String>>()
        var storedCharacters = 0

        messages.asReversed().take(80).forEach { (role, rawText) ->
            val safeRole = when (role) {
                "user" -> "user"
                "assistant" -> "assistant"
                else -> return@forEach
            }

            if (storedCharacters >= 240_000) {
                return@forEach
            }

            val text = rawText
                .trim()
                .take(20_000)
                .take(240_000 - storedCharacters)

            if (text.isBlank()) {
                return@forEach
            }

            storedCharacters += text.length
            selected += safeRole to text
        }

        return selected.asReversed()
    }

    private fun generatedTitle(
        messages: List<Pair<String, String>>
    ): String {
        val firstMessage = messages.firstOrNull {
            it.first == "user" && it.second.isNotBlank()
        }?.second ?: return "New chat"

        val clean = firstMessage
            .substringBefore("\n")
            .replace(Regex("\\s+"), " ")
            .trim()

        if (clean.isBlank()) {
            return "New chat"
        }

        return if (clean.length <= 54) {
            clean
        } else {
            clean.take(53).trimEnd() + "…"
        }
    }

    private fun readLegacyChatHistory(): List<Pair<String, String>> {
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
                        add(role to text)
                    }
                }
            }
        }.getOrDefault(emptyList())
    }

    private fun readChatThreads(): List<ChatThread> {
        val raw = readSecret("chat_threads_v2")
            ?: return emptyList()

        return runCatching {
            val array = JSONArray(raw)

            buildList {
                for (index in 0 until array.length()) {
                    val item = array.optJSONObject(index)
                        ?: continue
                    val id = item.optString("id")

                    if (id.isBlank()) {
                        continue
                    }

                    val messageArray = item.optJSONArray("messages")
                        ?: JSONArray()
                    val messages = buildList {
                        for (
                            messageIndex in 0 until messageArray.length()
                        ) {
                            val message = messageArray
                                .optJSONObject(messageIndex)
                                ?: continue
                            val role = message.optString("role")
                            val text = message.optString("text")

                            if (
                                (role == "user" ||
                                    role == "assistant") &&
                                text.isNotBlank()
                            ) {
                                add(role to text)
                            }
                        }
                    }

                    val createdAt = item.optLong(
                        "createdAt",
                        System.currentTimeMillis()
                    )

                    add(
                        ChatThread(
                            id = id,
                            title = item.optString(
                                "title",
                                "New chat"
                            ).ifBlank { "New chat" },
                            createdAt = createdAt,
                            updatedAt = item.optLong(
                                "updatedAt",
                                createdAt
                            ),
                            messages = normalizeMessages(messages)
                        )
                    )
                }
            }
        }.getOrDefault(emptyList())
    }

    private fun writeChatThreads(threads: List<ChatThread>) {
        val array = JSONArray()

        threads
            .sortedByDescending { it.updatedAt }
            .take(40)
            .forEach { thread ->
                val messages = JSONArray()
                normalizeMessages(thread.messages).forEach { (role, text) ->
                    messages.put(
                        JSONObject()
                            .put("role", role)
                            .put("text", text)
                    )
                }

                array.put(
                    JSONObject()
                        .put("id", thread.id)
                        .put("title", thread.title)
                        .put("createdAt", thread.createdAt)
                        .put("updatedAt", thread.updatedAt)
                        .put("messages", messages)
                )
            }

        saveSecret("chat_threads_v2", array.toString())
    }

    @Synchronized
    fun chatThreads(): List<ChatThread> {
        val existing = readChatThreads()
        if (existing.isNotEmpty()) {
            return existing.sortedByDescending { it.updatedAt }
        }

        val legacy = normalizeMessages(readLegacyChatHistory())
        if (legacy.isEmpty()) {
            return emptyList()
        }

        val now = System.currentTimeMillis()
        val migrated = ChatThread(
            id = UUID.randomUUID().toString(),
            title = generatedTitle(legacy),
            createdAt = now,
            updatedAt = now,
            messages = legacy
        )

        writeChatThreads(listOf(migrated))
        selectChatThread(migrated.id)
        preferences.edit().remove("chat_history_v1").apply()
        return listOf(migrated)
    }

    @Synchronized
    fun createChatThread(): ChatThread {
        val now = System.currentTimeMillis()
        val thread = ChatThread(
            id = UUID.randomUUID().toString(),
            title = "New chat",
            createdAt = now,
            updatedAt = now,
            messages = emptyList()
        )

        writeChatThreads(listOf(thread) + chatThreads())
        selectChatThread(thread.id)
        return thread
    }

    @Synchronized
    fun ensureChatThread(): ChatThread {
        val threads = chatThreads()
        val selectedId = selectedChatThreadId()
        val selected = threads.firstOrNull { it.id == selectedId }
            ?: threads.firstOrNull()

        if (selected != null) {
            selectChatThread(selected.id)
            return selected
        }

        return createChatThread()
    }

    fun chatThread(id: String): ChatThread? =
        chatThreads().firstOrNull { it.id == id }

    @Synchronized
    fun saveChatThread(
        id: String,
        messages: List<Pair<String, String>>
    ) {
        if (id.isBlank()) {
            return
        }

        val now = System.currentTimeMillis()
        val normalized = normalizeMessages(messages)
        val threads = chatThreads().toMutableList()
        val index = threads.indexOfFirst { it.id == id }
        val previous = threads.getOrNull(index)
        val title = if (
            previous == null ||
            previous.title == "New chat"
        ) {
            generatedTitle(normalized)
        } else {
            previous.title
        }

        val updated = ChatThread(
            id = id,
            title = title,
            createdAt = previous?.createdAt ?: now,
            updatedAt = now,
            messages = normalized
        )

        if (index >= 0) {
            threads[index] = updated
        } else {
            threads += updated
        }

        writeChatThreads(threads)
    }

    fun selectedChatThreadId(): String? =
        readSecret("selected_chat_thread_v2")

    fun selectChatThread(id: String) {
        if (id.isNotBlank()) {
            saveSecret("selected_chat_thread_v2", id)
        }
    }

    fun saveChatHistory(messages: List<Pair<String, String>>) {
        val thread = ensureChatThread()
        saveChatThread(thread.id, messages)
    }

    fun chatHistory(): List<Pair<String, String>> =
        ensureChatThread().messages

    fun clearChatHistory() {
        preferences.edit()
            .remove("chat_history_v1")
            .remove("chat_threads_v2")
            .remove("selected_chat_thread_v2")
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
            .remove("chat_threads_v2")
            .remove("selected_chat_thread_v2")
            .apply()
    }
}
