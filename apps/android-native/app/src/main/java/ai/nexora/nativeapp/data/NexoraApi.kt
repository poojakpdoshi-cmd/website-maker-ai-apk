package ai.nexora.nativeapp.data

import ai.nexora.nativeapp.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
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
    val versionNumber: Int,
    val fileCount: Int = 0,
    val filePaths: List<String> = emptyList()
)

data class NativeSourceFile(
    val path: String,
    val content: String
)

data class NativeProjectSource(
    val projectId: String,
    val projectName: String,
    val versionNumber: Int,
    val files: List<NativeSourceFile>
)

data class NativeCmsSettings(
    val enabled: Boolean,
    val publicSlug: String,
    val contentVersion: Int
)

data class NativeCmsDocument(
    val id: String,
    val collection: String,
    val slug: String,
    val title: String,
    val status: String,
    val contentJson: String,
    val updatedAt: String
)

data class NativeCmsWorkspace(
    val settings: NativeCmsSettings?,
    val documents: List<NativeCmsDocument>
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
    val lifetimeUsed: Int,
    val planMonthlyTokens: Int = 0,
    val subscriptionStatus: String = "active",
    val cycleEnd: String = "",
    val renewsAt: String = "",
    val monthlyBalance: Int = 0,
    val topupBalance: Int = 0,
    val reservedBalance: Int = 0
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
        message: String,
        mode: String,
        history: List<Pair<String, String>> = emptyList()
    ): String = withContext(Dispatchers.IO) {
        val historyJson = JSONArray().apply {
            history.takeLast(18).forEach { (role, content) ->
                put(
                    JSONObject()
                        .put("role", role)
                        .put("content", content.take(12000))
                )
            }
        }

        requestJson(
            "/assistant/chat",
            "POST",
            JSONObject()
                .put("message", message)
                .put("username", username)
                .put("email", email)
                .put("installationId", installationId)
                .put("mode", mode)
                .put("history", historyJson),
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
        val rawPaths = version?.optJSONArray("file_paths")
        val filePaths = buildList {
            if (rawPaths != null) {
                for (index in 0 until rawPaths.length()) {
                    rawPaths.optString(index)
                        .takeIf { it.isNotBlank() }
                        ?.let(::add)
                }
            }
        }

        NativeProjectDetail(
            response.getJSONObject("project").toProject(),
            version?.optString("preview_html").orEmpty(),
            version?.optInt("version_number", 0) ?: 0,
            version?.optInt("file_count", filePaths.size)
                ?: filePaths.size,
            filePaths
        )
    }

    suspend fun getProjectSource(
        token: String,
        installationId: String,
        email: String,
        projectId: String
    ): NativeProjectSource = withContext(Dispatchers.IO) {
        val response = requestJson(
            "/projects/" +
                URLEncoder.encode(
                    projectId,
                    Charsets.UTF_8.name()
                ) +
                "/source?email=" +
                URLEncoder.encode(
                    email,
                    Charsets.UTF_8.name()
                ),
            "GET",
            token = token,
            installationId = installationId
        )

        val values = response.optJSONArray("files")
            ?: JSONArray()

        NativeProjectSource(
            projectId = response.optString(
                "projectId",
                projectId
            ),
            projectName = response.optString(
                "projectName",
                "nexora-project"
            ),
            versionNumber = response.optInt(
                "versionNumber",
                1
            ),
            files = buildList {
                for (index in 0 until values.length()) {
                    val file = values.optJSONObject(index)
                        ?: continue
                    val path = file.optString("path")
                    if (path.isNotBlank()) {
                        add(
                            NativeSourceFile(
                                path = path,
                                content = file.optString(
                                    "content"
                                )
                            )
                        )
                    }
                }
            }
        )
    }

    suspend fun getCmsWorkspace(
        token: String,
        installationId: String,
        email: String,
        projectId: String
    ): NativeCmsWorkspace = withContext(Dispatchers.IO) {
        val response = requestJson(
            "/cms/projects/" +
                URLEncoder.encode(
                    projectId,
                    Charsets.UTF_8.name()
                ) +
                "?email=" +
                URLEncoder.encode(
                    email,
                    Charsets.UTF_8.name()
                ),
            "GET",
            token = token,
            installationId = installationId
        )

        response.toCmsWorkspace()
    }

    suspend fun bootstrapCms(
        token: String,
        installationId: String,
        email: String,
        projectId: String
    ): NativeCmsWorkspace = withContext(Dispatchers.IO) {
        requestJson(
            "/cms/projects/" +
                URLEncoder.encode(
                    projectId,
                    Charsets.UTF_8.name()
                ) +
                "/bootstrap?email=" +
                URLEncoder.encode(
                    email,
                    Charsets.UTF_8.name()
                ),
            "POST",
            JSONObject(),
            token,
            installationId
        )

        getCmsWorkspace(
            token,
            installationId,
            email,
            projectId
        )
    }

    suspend fun createCmsDocument(
        token: String,
        installationId: String,
        email: String,
        projectId: String,
        collection: String,
        slug: String,
        title: String,
        content: JSONObject
    ): NativeCmsDocument = withContext(Dispatchers.IO) {
        requestJson(
            "/cms/projects/" +
                URLEncoder.encode(
                    projectId,
                    Charsets.UTF_8.name()
                ) +
                "/documents?email=" +
                URLEncoder.encode(
                    email,
                    Charsets.UTF_8.name()
                ),
            "POST",
            JSONObject()
                .put("collection", collection)
                .put("slug", slug)
                .put("title", title)
                .put("status", "draft")
                .put("content", content)
                .put("seo", JSONObject())
                .put("sortOrder", 0),
            token,
            installationId
        ).getJSONObject("document").toCmsDocument()
    }

    suspend fun updateCmsDocument(
        token: String,
        installationId: String,
        email: String,
        documentId: String,
        collection: String,
        slug: String,
        title: String,
        content: JSONObject
    ): NativeCmsDocument = withContext(Dispatchers.IO) {
        requestJson(
            "/cms/documents/" +
                URLEncoder.encode(
                    documentId,
                    Charsets.UTF_8.name()
                ) +
                "?email=" +
                URLEncoder.encode(
                    email,
                    Charsets.UTF_8.name()
                ),
            "PATCH",
            JSONObject()
                .put("collection", collection)
                .put("slug", slug)
                .put("title", title)
                .put("content", content),
            token,
            installationId
        ).getJSONObject("document").toCmsDocument()
    }

    suspend fun setCmsDocumentPublished(
        token: String,
        installationId: String,
        email: String,
        documentId: String,
        published: Boolean
    ): NativeCmsDocument = withContext(Dispatchers.IO) {
        val action = if (published) "publish" else "draft"
        requestJson(
            "/cms/documents/" +
                URLEncoder.encode(
                    documentId,
                    Charsets.UTF_8.name()
                ) +
                "/$action?email=" +
                URLEncoder.encode(
                    email,
                    Charsets.UTF_8.name()
                ),
            "POST",
            JSONObject(),
            token,
            installationId
        ).getJSONObject("document").toCmsDocument()
    }

    suspend fun deleteCmsDocument(
        token: String,
        installationId: String,
        email: String,
        documentId: String
    ) = withContext(Dispatchers.IO) {
        requestJson(
            "/cms/documents/" +
                URLEncoder.encode(
                    documentId,
                    Charsets.UTF_8.name()
                ) +
                "?email=" +
                URLEncoder.encode(
                    email,
                    Charsets.UTF_8.name()
                ),
            "DELETE",
            token = token,
            installationId = installationId
        )
    }

    private fun JSONObject.toCmsWorkspace(): NativeCmsWorkspace {
        val rawSettings = optJSONObject("settings")
        val settings = rawSettings?.let {
            NativeCmsSettings(
                enabled = it.optBoolean("enabled", false),
                publicSlug = it.optString("public_slug"),
                contentVersion = it.optInt("content_version", 0)
            )
        }
        val rawDocuments = optJSONArray("documents")
            ?: JSONArray()

        return NativeCmsWorkspace(
            settings = settings,
            documents = buildList {
                for (index in 0 until rawDocuments.length()) {
                    rawDocuments.optJSONObject(index)
                        ?.let { add(it.toCmsDocument()) }
                }
            }
        )
    }

    private fun JSONObject.toCmsDocument(): NativeCmsDocument {
        val rawContent = optJSONObject("content")
            ?: JSONObject()

        return NativeCmsDocument(
            id = optString("id"),
            collection = optString("collection", "pages"),
            slug = optString("slug"),
            title = optString("title", "Untitled"),
            status = optString("status", "draft"),
            contentJson = runCatching {
                rawContent.toString(2)
            }.getOrElse { rawContent.toString() },
            updatedAt = optString("updated_at")
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

    suspend fun launchGeneration(
        token: String,
        installationId: String,
        email: String,
        prompt: String,
        jobId: String,
        generationMode: String = "standard",
        thinkMax: Boolean = false,
        image: NativeImageAttachment? = null
    ) = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("email", email)
            .put("installationId", installationId)
            .put("prompt", prompt)
            .put("jobId", jobId)
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

        var lastError: Throwable? = null

        repeat(3) { attempt ->
            try {
                requestJson(
                    "/generate",
                    "POST",
                    body,
                    token,
                    installationId,
                    allowConflict = true
                )
                return@withContext
            } catch (error: Throwable) {
                lastError = error
                if (attempt < 2) {
                    delay(1200L * (attempt + 1))
                }
            }
        }

        throw lastError ?: IllegalStateException(
            "Could not connect the website generation worker."
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
                            ),
                            account.optInt(
                                "plan_monthly_tokens"
                            ),
                            account.optString(
                                "subscription_status",
                                "active"
                            ),
                            account.optString("cycle_end"),
                            account.optString("renews_at"),
                            account.optInt("monthly_balance"),
                            account.optInt("topup_balance"),
                            account.optInt("reserved_balance")
                        )
                    )
                }
            }
        }

    suspend fun adminUpdateBilling(
        token: String,
        id: String,
        planId: String,
        status: String,
        cycleEnd: String,
        tokenAdjustment: Int
    ) = withContext(Dispatchers.IO) {
        requestJson(
            "/admin/accounts/" +
                URLEncoder.encode(
                    id,
                    Charsets.UTF_8.name()
                ) +
                "/billing",
            "PATCH",
            JSONObject()
                .put("planId", planId)
                .put("status", status)
                .put("cycleEnd", cycleEnd)
                .put("tokenAdjustment", tokenAdjustment),
            token
        )
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
        installationId: String? = null,
        allowConflict: Boolean = false
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

            if (
                code !in 200..299 &&
                !(allowConflict && code == 409)
            ) {
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
