package ai.nexora.nativeapp

import ai.nexora.nativeapp.data.NativeIntegrationStatus
import ai.nexora.nativeapp.data.NativeProject
import ai.nexora.nativeapp.data.NativeProjectDetail
import ai.nexora.nativeapp.data.NexoraApi
import ai.nexora.nativeapp.data.SessionStore
import androidx.compose.foundation.clickable
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
fun StudioScreen(
    sessionStore: SessionStore,
    installationId: String
) {
    var section by remember { mutableStateOf("create") }

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            FilterChip(
                selected = section == "create",
                onClick = { section = "create" },
                label = { Text("Create") },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor =
                        MaterialTheme.colorScheme.primaryContainer,
                    selectedLabelColor =
                        MaterialTheme.colorScheme.onPrimaryContainer
                )
            )
            FilterChip(
                selected = section == "manage",
                onClick = { section = "manage" },
                label = { Text("Edit & Publish") },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor =
                        MaterialTheme.colorScheme.primaryContainer,
                    selectedLabelColor =
                        MaterialTheme.colorScheme.onPrimaryContainer
                )
            )
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        ) {
            Crossfade(
                targetState = section,
                animationSpec = tween(220),
                label = "Studio section transition"
            ) { destination ->
                if (destination == "create") {
                    GenerationScreen(sessionStore, installationId)
                } else {
                    ProjectStudioScreen(sessionStore, installationId)
                }
            }
        }
    }
}

@Composable
private fun ProjectStudioScreen(
    sessionStore: SessionStore,
    installationId: String
) {
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current

    var projects by remember {
        mutableStateOf<List<NativeProject>>(emptyList())
    }
    var selected by remember {
        mutableStateOf<NativeProject?>(null)
    }
    var detail by remember {
        mutableStateOf<NativeProjectDetail?>(null)
    }
    var connections by remember {
        mutableStateOf(NativeIntegrationStatus())
    }

    var editInstruction by remember { mutableStateOf("") }
    var githubToken by remember { mutableStateOf("") }
    var vercelToken by remember { mutableStateOf("") }
    var githubAdvanced by remember { mutableStateOf(false) }
    var vercelAdvanced by remember { mutableStateOf(false) }
    var publishedUrl by remember { mutableStateOf("") }
    var publishState by remember { mutableStateOf("") }
    var publishWarnings by remember {
        mutableStateOf<List<String>>(emptyList())
    }

    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var errorText by remember { mutableStateOf("") }

    fun token(): String =
        sessionStore.token() ?: error("Session missing")

    fun email(): String =
        sessionStore.email() ?: error("Email missing")

    suspend fun refreshAll() {
        projects = NexoraApi.listProjects(
            token(),
            installationId,
            email()
        )
        connections = NexoraApi.integrationStatus(
            token(),
            installationId,
            email()
        )
    }

    fun launchTask(block: suspend () -> Unit) {
        busy = true
        message = ""
        errorText = ""
        scope.launch {
            try {
                block()
            } catch (taskError: Throwable) {
                errorText = taskError.message ?: "Operation failed."
            } finally {
                busy = false
            }
        }
    }

    fun startOAuth(provider: String) {
        launchTask {
            val start = NexoraApi.startIntegrationOAuth(
                token(),
                installationId,
                email(),
                provider
            )

            uriHandler.openUri(start.authorizationUrl)
            message =
                "Complete the ${if (provider == "github") "GitHub" else "Vercel"} " +
                    "connection in your browser, return here, then refresh " +
                    "the connection status."
        }
    }

    LaunchedEffect(Unit) {
        launchTask { refreshAll() }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 14.dp,
            end = 14.dp,
            bottom = 24.dp
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Text(
                "Project Studio",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Black
            )
        }
        item {
            Text(
                "Edit generated websites, connect deployment accounts and publish from the native app.",
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        if (busy) {
            item {
                LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        }
        if (message.isNotBlank()) {
            item {
                Text(
                    message,
                    color = MaterialTheme.colorScheme.primary
                )
            }
        }
        if (errorText.isNotBlank()) {
            item {
                Text(
                    errorText,
                    color = MaterialTheme.colorScheme.error
                )
            }
        }

        item {
            ElevatedCard(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(22.dp)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        "Deployment connections",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )

                    Text(
                        "OAuth is the recommended connection method. " +
                            "Access-token entry is available only as an " +
                            "advanced fallback.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    OutlinedButton(
                        enabled = !busy,
                        onClick = {
                            launchTask {
                                connections =
                                    NexoraApi.integrationStatus(
                                        token(),
                                        installationId,
                                        email()
                                    )
                                message = "Connection status refreshed."
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Refresh connection status")
                    }

                    Text(
                        if (connections.github != null) {
                            "GitHub: ${connections.github?.accountName ?: "Connected"}"
                        } else {
                            "GitHub: Not connected"
                        },
                        color = if (connections.github != null) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )

                    Button(
                        enabled = !busy,
                        onClick = { startOAuth("github") },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            if (connections.github == null) {
                                "Connect GitHub with OAuth"
                            } else {
                                "Reconnect GitHub with OAuth"
                            }
                        )
                    }

                    if (connections.github == null) {
                        TextButton(
                            enabled = !busy,
                            onClick = {
                                githubAdvanced = !githubAdvanced
                                githubToken = ""
                            }
                        ) {
                            Text(
                                if (githubAdvanced) {
                                    "Hide advanced GitHub fallback"
                                } else {
                                    "Advanced: use GitHub access token"
                                }
                            )
                        }

                        if (githubAdvanced) {
                            OutlinedTextField(
                                value = githubToken,
                                onValueChange = { githubToken = it },
                                modifier = Modifier.fillMaxWidth(),
                                label = { Text("GitHub access token") },
                                singleLine = true,
                                visualTransformation =
                                    PasswordVisualTransformation(),
                                colors = nexoraOutlinedFieldColors()
                            )
                            OutlinedButton(
                                enabled = !busy &&
                                    githubToken.trim().length >= 10,
                                onClick = {
                                    val rawToken = githubToken.trim()
                                    launchTask {
                                        NexoraApi.connectIntegration(
                                            token(),
                                            installationId,
                                            email(),
                                            "github",
                                            rawToken
                                        )
                                        githubToken = ""
                                        githubAdvanced = false
                                        connections =
                                            NexoraApi.integrationStatus(
                                                token(),
                                                installationId,
                                                email()
                                            )
                                        message = "GitHub connected."
                                    }
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Connect using access token")
                            }
                        }
                    }

                    Spacer(Modifier.height(4.dp))

                    Text(
                        if (connections.vercel != null) {
                            "Vercel: ${connections.vercel?.accountName ?: "Connected"}"
                        } else {
                            "Vercel: Not connected"
                        },
                        color = if (connections.vercel != null) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )

                    Button(
                        enabled = !busy,
                        onClick = { startOAuth("vercel") },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            if (connections.vercel == null) {
                                "Connect Vercel with OAuth"
                            } else {
                                "Reconnect Vercel with OAuth"
                            }
                        )
                    }

                    if (connections.vercel == null) {
                        TextButton(
                            enabled = !busy,
                            onClick = {
                                vercelAdvanced = !vercelAdvanced
                                vercelToken = ""
                            }
                        ) {
                            Text(
                                if (vercelAdvanced) {
                                    "Hide advanced Vercel fallback"
                                } else {
                                    "Advanced: use Vercel access token"
                                }
                            )
                        }

                        if (vercelAdvanced) {
                            OutlinedTextField(
                                value = vercelToken,
                                onValueChange = { vercelToken = it },
                                modifier = Modifier.fillMaxWidth(),
                                label = { Text("Vercel access token") },
                                singleLine = true,
                                visualTransformation =
                                    PasswordVisualTransformation(),
                                colors = nexoraOutlinedFieldColors()
                            )
                            OutlinedButton(
                                enabled = !busy &&
                                    vercelToken.trim().length >= 10,
                                onClick = {
                                    val rawToken = vercelToken.trim()
                                    launchTask {
                                        NexoraApi.connectIntegration(
                                            token(),
                                            installationId,
                                            email(),
                                            "vercel",
                                            rawToken
                                        )
                                        vercelToken = ""
                                        vercelAdvanced = false
                                        connections =
                                            NexoraApi.integrationStatus(
                                                token(),
                                                installationId,
                                                email()
                                            )
                                        message = "Vercel connected."
                                    }
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Connect using access token")
                            }
                        }
                    }

                    if (
                        connections.github == null ||
                        connections.vercel == null
                    ) {
                        Text(
                            "Nexora never displays or logs a saved provider " +
                                "token.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }

        if (selected == null) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        "Choose a project",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                    TextButton(
                        enabled = !busy,
                        onClick = {
                            launchTask { refreshAll() }
                        }
                    ) {
                        Text("Refresh")
                    }
                }
            }

            if (projects.isEmpty() && !busy) {
                item {
                    Text(
                        "No generated projects found yet.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            items(projects, key = { it.id }) { project ->
                ElevatedCard(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            selected = project
                            launchTask {
                                detail = NexoraApi.getProject(
                                    token(),
                                    installationId,
                                    email(),
                                    project.id
                                )
                            }
                        },
                    shape = RoundedCornerShape(22.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(5.dp)
                    ) {
                        Text(
                            project.name,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            "${project.websiteType} · ${project.framework}",
                            color = MaterialTheme.colorScheme.secondary
                        )
                        Text("Status: ${project.status}")
                    }
                }
            }
        } else {
            item {
                TextButton(
                    onClick = {
                        selected = null
                        detail = null
                        editInstruction = ""
                        publishedUrl = ""
                        publishState = ""
                        publishWarnings = emptyList()
                        message = ""
                        errorText = ""
                    }
                ) {
                    Text("← Choose another project")
                }
            }

            item {
                ElevatedCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(22.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(7.dp)
                    ) {
                        Text(
                            selected?.name.orEmpty(),
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Black
                        )
                        Text(
                            "${selected?.websiteType.orEmpty()} · ${selected?.framework.orEmpty()}",
                            color = MaterialTheme.colorScheme.secondary
                        )
                        Text(
                            "Current version: ${detail?.versionNumber ?: "Loading…"}"
                        )
                    }
                }
            }

            item {
                ElevatedCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(22.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Text(
                            "AI website editor",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold
                        )
                        OutlinedTextField(
                            value = editInstruction,
                            onValueChange = { editInstruction = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Describe the changes") },
                            minLines = 4,
                            maxLines = 8,
                            colors = nexoraOutlinedFieldColors()
                        )
                        Button(
                            enabled = !busy &&
                                editInstruction.isNotBlank() &&
                                selected != null,
                            onClick = {
                                val project = selected ?: return@Button
                                val instruction = editInstruction.trim()
                                launchTask {
                                    val edited = NexoraApi.editProject(
                                        token(),
                                        installationId,
                                        email(),
                                        project.id,
                                        instruction
                                    )
                                    detail = NexoraApi.getProject(
                                        token(),
                                        installationId,
                                        email(),
                                        project.id
                                    )
                                    editInstruction = ""
                                    message =
                                        "Version ${edited.versionNumber} created."
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Apply AI edit")
                        }
                    }
                }
            }

            item {
                ElevatedCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(22.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Text(
                            "Publish website",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            "Nexora will run final checks, push the project to GitHub and create a Vercel deployment.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Button(
                            enabled = !busy &&
                                selected != null &&
                                connections.github != null &&
                                connections.vercel != null,
                            onClick = {
                                val project = selected ?: return@Button
                                publishState = "Publishing"
                                publishWarnings = emptyList()
                                launchTask {
                                    try {
                                        val published =
                                            NexoraApi.publishProject(
                                                token(),
                                                installationId,
                                                email(),
                                                project.id
                                            )
                                        publishedUrl =
                                            published.productionUrl
                                        publishState = published.state
                                            .ifBlank { "Unknown" }
                                        publishWarnings =
                                            published.warnings
                                        message = if (
                                            published.productionUrl
                                                .isNotBlank()
                                        ) {
                                            "Publishing completed with " +
                                                "state ${publishState}."
                                        } else {
                                            "Publish request completed " +
                                                "with state ${publishState}."
                                        }
                                        refreshAll()
                                    } catch (publishError: Throwable) {
                                        publishState = "Failed"
                                        publishedUrl = ""
                                        throw publishError
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Publish to GitHub + Vercel")
                        }

                        if (
                            connections.github == null ||
                            connections.vercel == null
                        ) {
                            Text(
                                "Connect both GitHub and Vercel before publishing.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error
                            )
                        }

                        if (publishState.isNotBlank()) {
                            Text("Deployment state: $publishState")
                        }
                        if (publishWarnings.isNotEmpty()) {
                            Text(
                                "Security warnings",
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.tertiary
                            )
                            publishWarnings.forEach { warning ->
                                Text(
                                    "• $warning",
                                    style =
                                        MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme
                                        .onSurfaceVariant
                                )
                            }
                        }
                        if (publishedUrl.isNotBlank()) {
                            OutlinedButton(
                                onClick = {
                                    runCatching {
                                        uriHandler.openUri(publishedUrl)
                                    }.onFailure {
                                        errorText =
                                            "Could not open the published URL."
                                    }
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Open live website")
                            }
                            Text(
                                publishedUrl,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            }

            detail?.let { projectDetail ->
                item {
                    ElevatedCard(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(22.dp)
                    ) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(
                                "Latest preview source",
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                if (projectDetail.previewHtml.isBlank()) {
                                    "No preview HTML is available."
                                } else {
                                    projectDetail.previewHtml.take(1800)
                                },
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            }
        }
    }
}
