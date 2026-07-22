package ai.nexora.nativeapp.data

import ai.nexora.nativeapp.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class LoginResult(
    val token: String,
    val username: String,
    val internalEmail: String
)

data class NativeProject(
    val id: String,
    val name: String,
    val websiteType: String,
    val status: String,
    val framework: String,
    val createdAt: String,
    val updatedAt: String
)

data class NativeProjectDetail(
    val project: NativeProject,
    val previewHtml: String,
    val versionNumber: Int
)

data class NativeImageAttachment(
    val name: String,
    val mimeType: String,
    val data: String
)

data class NativeGenerationStart(
    val jobId: String,
    val status: String,
    val progress: Int
)

data class NativeGenerationStatus(
    val jobId: String,
    val status: String,
    val progress: Int,
    val projectId: String? = null,
    val currentAgent: String? = null,
    val currentStep: String? = null,
    val errorMessage: String? = null
)

data class AdminLoginResult(
    val token: String,
    val username: String,
    val expiresAt: String
)

data class AdminSummary(
    val activeSubscribers: Int = 0,
    val pendingPayments: Int = 0,
    val websitesGenerated: Int = 0,
    val failedJobs: Int = 0,
    val activeDevices: Int = 0,
    val deployments: Int = 0
)

data class AdminAccount(
    val id: String,
    val username: String,
    val internalEmail: String,
    val status: String,
    val planId: String,
    val planName: String,
    val tokenBalance: Int,
    val lifetimeUsed: Int
)

data class NativeIntegrationAccount(
    val accountName: String? = null
)

data class NativeIntegrationStatus(
    val github: NativeIntegrationAccount? = null,
    val vercel: NativeIntegrationAccount? = null
)

data class NativeEditResult(
    val projectId: String,
    val versionNumber: Int,
    val previewHtml: String
)

data class NativePublishResult(
    val productionUrl: String,
    val state: String
)

object NexoraApi {
    suspend fun login(
        username: String,
        password: String,
        installationId: String
    ): LoginResult = withContext(Dispatchers.IO) {
        val response = requestJson(
            "/auth/login",
            "POST",
            JSONObject()
                .put("username", username)
                .put("password", password)
                .put("installationId", installationId)
        )

        LoginResult(
            response.getString("token"),
            response.getString("username"),
            response.getString("internalEmail")
        )
    }

    suspend fun sendChat(
        token: String,
        installationId: String,
        username: String,
        email: String,
        message: String
    ): String = withContext(Dispatchers.IO) {
        requestJson(
            "/assistant/chat",
            "POST",
            JSONObject()
                .put("message", message)
                .put("username", username)
                .put("email", email)
                .put("installationId", installationId)
                .put("history", JSONArray()),
            token,
            installationId
        ).optString(
            "reply",
            "Nexora did not return a reply."
        )
    }

    suspend fun listProjects(
        token: String,
        installationId: String,
        email: String
    ): List<NativeProject> = withContext(Dispatchers.IO) {
        val projects = requestJson(
            "/projects?email=" +
                URLEncoder.encode(
                    email,
                    Charsets.UTF_8.name()
                ),
            "GET",
            token = token,
            installationId = installationId
        ).optJSONArray("projects") ?: JSONArray()

        buildList {
            for (index in 0 until projects.length()) {
                add(projects.getJSONObject(index).toProject())
            }
        }
    }

    suspend fun getProject(
        token: String,
        installationId: String,
        email: String,
        projectId: String
    ): NativeProjectDetail = withContext(Dispatchers.IO) {
        val response = requestJson(
            "/projects/$projectId?email=" +
                URLEncoder.encode(
                    email,
                    Charsets.UTF_8.name()
                ),
            "GET",
            token = token,
            installationId = installationId
        )

        val version = response.optJSONObject("version")

        NativeProjectDetail(
            response.getJSONObject("project").toProject(),
            version?.optString("preview_html").orEmpty(),
            version?.optInt("version_number", 0) ?: 0
        )
    }

    private fun JSONObject.toProject() =
        NativeProject(
            optString("id"),
            optString("name", "Untitled project"),
            optString("website_type", "Website"),
            optString("status", "Unknown"),
            optString("framework", "Unknown"),
            optString("created_at"),
            optString("updated_at")
        )

    suspend fun startGeneration(
        token: String,
        installationId: String,
        email: String,
        prompt: String,
        generationMode: String = "standard",
        thinkMax: Boolean = false,
        image: NativeImageAttachment? = null
    ): NativeGenerationStart =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("email", email)
                .put("installationId", installationId)
                .put("prompt", prompt)
                .put("generationMode", generationMode)
                .put("thinkMax", thinkMax)

            image?.let {
                body.put(
                    "image",
                    JSONObject()
                        .put("name", it.name)
                        .put("mimeType", it.mimeType)
                        .put("data", it.data)
                )
            }

            val response = requestJson(
                "/generation-jobs/start",
                "POST",
                body,
                token,
                installationId
            )

            val job =
                response.optJSONObject("job") ?: response

            val jobId = sequenceOf(
                job.optString("_jobId"),
                job.optString("jobId"),
                job.optString("job_id"),
                job.optString("id"),
                response.optString("_jobId"),
                response.optString("jobId"),
                response.optString("job_id")
            ).firstOrNull { it.isNotBlank() }.orEmpty()

            require(jobId.isNotBlank()) {
                "Generation job ID missing"
            }

            NativeGenerationStart(
                jobId,
                job.optString(
                    "status",
                    response.optString("status", "queued")
                ),
                job.optInt(
                    "progress",
                    response.optInt("progress", 0)
                )
            )
        }

    suspend fun getGenerationStatus(
        token: String,
        installationId: String,
        email: String,
        jobId: String
    ): NativeGenerationStatus =
        withContext(Dispatchers.IO) {
            val response = requestJson(
                "/generation-jobs/$jobId?email=" +
                    URLEncoder.encode(
                        email,
                        Charsets.UTF_8.name()
                    ),
                "GET",
                token = token,
                installationId = installationId
            )

            val job =
                response.optJSONObject("job") ?: response

            val result =
                job.optJSONObject("result")
                    ?: response.optJSONObject("result")

            fun value(vararg keys: String): String? {
                for (key in keys) {
                    val fromJob = job.optString(key)
                    if (fromJob.isNotBlank()) {
                        return fromJob
                    }

                    val fromResult =
                        result?.optString(key).orEmpty()
                    if (fromResult.isNotBlank()) {
                        return fromResult
                    }

                    val fromResponse =
                        response.optString(key)
                    if (fromResponse.isNotBlank()) {
                        return fromResponse
                    }
                }
                return null
            }

            val status = value("status")
                ?: "queued"

            val progress = when {
                job.has("progress") ->
                    job.optInt("progress", 0)

                result?.has("progress") == true ->
                    result.optInt("progress", 0)

                else ->
                    response.optInt("progress", 0)
            }

            NativeGenerationStatus(
                jobId = jobId,
                status = status,
                progress = progress,
                projectId = value(
                    "projectId",
                    "project_id"
                ),
                currentAgent = value(
                    "currentAgent",
                    "current_agent"
                ),
                currentStep = value(
                    "currentStep",
                    "current_step"
                ),
                errorMessage = value(
                    "errorMessage",
                    "error_message",
                    "error"
                )
            )
        }

    suspend fun adminLogin(
        username: String,
        password: String
    ): AdminLoginResult =
        withContext(Dispatchers.IO) {
            val response = requestJson(
                "/admin/auth/login",
                "POST",
                JSONObject()
                    .put("username", username)
                    .put("password", password)
            )

            AdminLoginResult(
                response.getString("token"),
                response.optString("username", username),
                response.optString("expiresAt")
            )
        }

    suspend fun adminSummary(
        token: String
    ): AdminSummary = withContext(Dispatchers.IO) {
        val response = requestJson(
            "/admin/summary",
            "GET",
            token = token
        )

        AdminSummary(
            response.optInt("activeSubscribers"),
            response.optInt("pendingPayments"),
            response.optInt("websitesGenerated"),
            response.optInt("failedJobs"),
            response.optInt("activeDevices"),
            response.optInt("deployments")
        )
    }

    suspend fun adminAccounts(
        token: String
    ): List<AdminAccount> =
        withContext(Dispatchers.IO) {
            val values = requestJson(
                "/admin/accounts",
                "GET",
                token = token
            ).optJSONArray("accounts") ?: JSONArray()

            buildList {
                for (index in 0 until values.length()) {
                    val account =
                        values.getJSONObject(index)

                    add(
                        AdminAccount(
                            account.optString("id"),
                            account.optString("username"),
                            account.optString(
                                "internal_email"
                            ),
                            account.optString(
                                "status",
                                "unknown"
                            ),
                            account.optString("plan_id"),
                            account.optString("plan_name"),
                            account.optInt(
                                "token_balance"
                            ),
                            account.optInt(
                                "lifetime_used"
                            )
                        )
                    )
                }
            }
        }

    suspend fun adminCreateAccount(
        token: String,
        username: String,
        password: String
    ) = withContext(Dispatchers.IO) {
        requestJson(
            "/admin/accounts/create",
            "POST",
            JSONObject()
                .put("username", username)
                .put("password", password),
            token
        )
    }

    suspend fun adminChangePassword(
        token: String,
        id: String,
        password: String
    ) = withContext(Dispatchers.IO) {
        requestJson(
            "/admin/accounts/" +
                URLEncoder.encode(
                    id,
                    Charsets.UTF_8.name()
                ) +
                "/password",
            "PATCH",
            JSONObject().put("password", password),
            token
        )
    }

    suspend fun adminDeleteAccount(
        token: String,
        id: String
    ) = withContext(Dispatchers.IO) {
        requestJson(
            "/admin/accounts/" +
                URLEncoder.encode(
                    id,
                    Charsets.UTF_8.name()
                ),
            "DELETE",
            token = token
        )
    }

    suspend fun adminLogout(
        token: String
    ) = withContext(Dispatchers.IO) {
        requestJson(
            "/admin/auth/logout",
            "POST",
            token = token
        )
    }

    suspend fun integrationStatus(
        token: String,
        installationId: String,
        email: String
    ): NativeIntegrationStatus =
        withContext(Dispatchers.IO) {
            val response = requestJson(
                "/integrations/status?email=" +
                    URLEncoder.encode(
                        email,
                        Charsets.UTF_8.name()
                    ),
                "GET",
                token = token,
                installationId = installationId
            )

            fun account(
                name: String
            ): NativeIntegrationAccount? =
                response.optJSONObject(name)?.let {
                    NativeIntegrationAccount(
                        it.optString(
                            "external_account_name"
                        ).takeIf { value ->
                            value.isNotBlank()
                        }
                    )
                }

            NativeIntegrationStatus(
                account("github"),
                account("vercel")
            )
        }

    suspend fun connectIntegration(
        token: String,
        installationId: String,
        email: String,
        provider: String,
        rawToken: String
    ) = withContext(Dispatchers.IO) {
        require(
            provider == "github" ||
                provider == "vercel"
        ) {
            "Unsupported integration provider"
        }

        requestJson(
            "/integrations/$provider/token",
            "POST",
            JSONObject()
                .put("email", email)
                .put("installationId", installationId)
                .put("token", rawToken),
            token,
            installationId
        )
    }

    suspend fun editProject(
        token: String,
        installationId: String,
        email: String,
        projectId: String,
        instruction: String
    ): NativeEditResult =
        withContext(Dispatchers.IO) {
            val response = requestJson(
                "/projects/" +
                    URLEncoder.encode(
                        projectId,
                        Charsets.UTF_8.name()
                    ) +
                    "/edit",
                "POST",
                JSONObject()
                    .put("email", email)
                    .put(
                        "installationId",
                        installationId
                    )
                    .put("instruction", instruction),
                token,
                installationId
            )

            NativeEditResult(
                response.optString(
                    "projectId",
                    projectId
                ),
                response.optInt("versionNumber", 0),
                response.optString("previewHtml")
            )
        }

    suspend fun publishProject(
        token: String,
        installationId: String,
        email: String,
        projectId: String
    ): NativePublishResult =
        withContext(Dispatchers.IO) {
            val response = requestJson(
                "/projects/" +
                    URLEncoder.encode(
                        projectId,
                        Charsets.UTF_8.name()
                    ) +
                    "/publish",
                "POST",
                JSONObject()
                    .put("email", email)
                    .put(
                        "installationId",
                        installationId
                    ),
                token,
                installationId
            )

            NativePublishResult(
                response.optString("productionUrl"),
                response.optString(
                    "state",
                    "unknown"
                )
            )
        }

    private fun requestJson(
        path: String,
        method: String,
        body: JSONObject? = null,
        token: String? = null,
        installationId: String? = null
    ): JSONObject {
        val connection = URL(
            BuildConfig.API_BASE + path
        ).openConnection() as HttpURLConnection

        try {
            connection.requestMethod = method
            connection.connectTimeout = 20000
            connection.readTimeout = 90000
            connection.setRequestProperty(
                "Accept",
                "application/json"
            )

            token?.let {
                connection.setRequestProperty(
                    "Authorization",
                    "Bearer $it"
                )
            }

            installationId?.let {
                connection.setRequestProperty(
                    "X-Device-Id",
                    it
                )
            }

            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty(
                    "Content-Type",
                    "application/json"
                )
                connection.outputStream.use {
                    it.write(
                        body.toString().toByteArray()
                    )
                }
            }

            val code = connection.responseCode

            val raw = (
                if (code in 200..299) {
                    connection.inputStream
                } else {
                    connection.errorStream
                }
                )?.bufferedReader()?.use {
                    it.readText()
                }.orEmpty()

            val response = runCatching {
                JSONObject(raw)
            }.getOrElse {
                JSONObject().put(
                    "error",
                    "Unreadable response ($code)"
                )
            }

            if (code !in 200..299) {
                val message = sequenceOf(
                    response.optString("error"),
                    response.optString("message"),
                    response.optString("detail")
                ).firstOrNull {
                    it.isNotBlank()
                } ?: "Request failed ($code)"

                error(message)
            }

            return response
        } finally {
            connection.disconnect()
        }
    }
}
