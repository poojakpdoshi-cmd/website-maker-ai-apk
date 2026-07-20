package ai.nexora.nativeapp.data

import ai.nexora.nativeapp.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class LoginResult(
    val token: String,
    val username: String,
    val internalEmail: String
)

object NexoraApi {
    suspend fun login(
        username: String,
        password: String,
        installationId: String
    ): LoginResult = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("username", username)
            .put("password", password)
            .put("installationId", installationId)

        val response = request(
            path = "/auth/login",
            method = "POST",
            body = body
        )

        LoginResult(
            token = response.getString("token"),
            username = response.getString("username"),
            internalEmail = response.getString("internalEmail")
        )
    }

    suspend fun sendChat(
        token: String,
        installationId: String,
        username: String,
        email: String,
        message: String
    ): String = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("message", message)
            .put("username", username)
            .put("email", email)
            .put("installationId", installationId)
            .put("history", org.json.JSONArray())

        request(
            path = "/assistant/chat",
            method = "POST",
            body = body,
            token = token,
            installationId = installationId
        ).optString("reply", "Nexora did not return a reply.")
    }

    private fun request(
        path: String,
        method: String,
        body: JSONObject,
        token: String? = null,
        installationId: String? = null
    ): JSONObject {
        val connection = URL(BuildConfig.API_BASE + path)
            .openConnection() as HttpURLConnection

        try {
            connection.requestMethod = method
            connection.connectTimeout = 20_000
            connection.readTimeout = 90_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            token?.let {
                connection.setRequestProperty("Authorization", "Bearer $it")
            }
            installationId?.let {
                connection.setRequestProperty("X-Device-Id", it)
            }

            connection.outputStream.use {
                it.write(body.toString().toByteArray(Charsets.UTF_8))
            }

            val stream = if (connection.responseCode in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream
            }

            val raw = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(raw) }.getOrElse {
                JSONObject().put(
                    "error",
                    "Server returned an unreadable response (${connection.responseCode})."
                )
            }

            if (connection.responseCode !in 200..299) {
                throw IllegalStateException(
                    json.optString(
                        "error",
                        "Request failed (${connection.responseCode})."
                    )
                )
            }

            return json
        } finally {
            connection.disconnect()
        }
    }
}
