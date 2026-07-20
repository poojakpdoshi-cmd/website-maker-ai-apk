package ai.nexora.nativeapp

import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import ai.nexora.nativeapp.data.NexoraApi
import ai.nexora.nativeapp.data.SessionStore
import ai.nexora.nativeapp.ui.theme.NexoraTheme
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

data class ChatMessage(
    val role: String,
    val text: String
)

class MainActivity : ComponentActivity() {
    private lateinit var sessionStore: SessionStore
    private lateinit var installationId: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        sessionStore = SessionStore(this)
        installationId = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ANDROID_ID
        ) ?: "nexora-native-device"

        setContent {
            NexoraTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    var loggedIn by remember {
                        mutableStateOf(sessionStore.token() != null)
                    }

                    if (loggedIn) {
                        NativeChatScreen(
                            sessionStore = sessionStore,
                            installationId = installationId,
                            onLogout = {
                                sessionStore.clear()
                                loggedIn = false
                            }
                        )
                    } else {
                        NativeLoginScreen(
                            installationId = installationId,
                            onSuccess = { result ->
                                sessionStore.save(
                                    result.token,
                                    result.username,
                                    result.internalEmail
                                )
                                loggedIn = true
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun NativeLoginScreen(
    installationId: String,
    onSuccess: (ai.nexora.nativeapp.data.LoginResult) -> Unit
) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(22.dp)
    ) {
        Column(
            modifier = Modifier
                .align(Alignment.Center)
                .fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text(
                text = "Nexora.Ai",
                style = MaterialTheme.typography.displaySmall,
                fontWeight = FontWeight.Black
            )

            Text(
                text = "Native Android experience",
                color = MaterialTheme.colorScheme.secondary
            )

            OutlinedTextField(
                modifier = Modifier.fillMaxWidth(),
                value = username,
                onValueChange = { username = it },
                label = { Text("Username") },
                singleLine = true
            )

            OutlinedTextField(
                modifier = Modifier.fillMaxWidth(),
                value = password,
                onValueChange = { password = it },
                label = { Text("Password") },
                singleLine = true
            )

            AnimatedVisibility(error.isNotBlank()) {
                Text(error, color = MaterialTheme.colorScheme.error)
            }

            Button(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(54.dp),
                enabled = !loading &&
                    username.isNotBlank() &&
                    password.isNotBlank(),
                onClick = {
                    loading = true
                    error = ""

                    scope.launch {
                        runCatching {
                            NexoraApi.login(
                                username.trim(),
                                password,
                                installationId
                            )
                        }.onSuccess(onSuccess)
                            .onFailure {
                                error = it.message ?: "Login failed."
                            }

                        loading = false
                    }
                }
            ) {
                Text(if (loading) "Signing in…" else "Sign in")
            }

            DisableSelection {
                Text(
                    text = "Made by Poojak Doshi",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun NativeChatScreen(
    sessionStore: SessionStore,
    installationId: String,
    onLogout: () -> Unit
) {
    var input by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    val messages = remember {
        mutableStateListOf(
            ChatMessage(
                "assistant",
                "Nexora native shell is ready. Chat is fully native—no WebView."
            )
        )
    }
    val scope = rememberCoroutineScope()

    Column(modifier = Modifier.fillMaxSize()) {
        Surface(
            tonalElevation = 4.dp,
            color = MaterialTheme.colorScheme.surface
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(
                        start = 18.dp,
                        end = 12.dp,
                        top = 16.dp,
                        bottom = 12.dp
                    ),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "Nexora.Ai",
                        fontWeight = FontWeight.Black
                    )
                    Text(
                        "Native Android · Phase 1",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.secondary
                    )
                }

                TextButton(onClick = onLogout) {
                    Text("Logout")
                }
            }
        }

        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            items(messages) { message ->
                DisableSelection {
                    Surface(
                        modifier = Modifier.fillMaxWidth(
                            if (message.role == "user") .86f else .94f
                        ),
                        shape = RoundedCornerShape(18.dp),
                        color = if (message.role == "user") {
                            MaterialTheme.colorScheme.primaryContainer
                        } else {
                            MaterialTheme.colorScheme.surfaceVariant
                        }
                    ) {
                        Text(
                            modifier = Modifier.padding(14.dp),
                            text = message.text
                        )
                    }
                }
            }
        }

        Surface(
            tonalElevation = 8.dp,
            color = MaterialTheme.colorScheme.surface
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    modifier = Modifier.weight(1f),
                    value = input,
                    onValueChange = { input = it },
                    placeholder = { Text("Message Nexora…") },
                    maxLines = 5
                )

                Button(
                    enabled = input.isNotBlank() && !loading,
                    onClick = {
                        val request = input.trim()
                        input = ""
                        messages += ChatMessage("user", request)
                        loading = true

                        scope.launch {
                            val reply = runCatching {
                                NexoraApi.sendChat(
                                    token = sessionStore.token()
                                        ?: error("Session missing."),
                                    installationId = installationId,
                                    username = sessionStore.username()
                                        ?: "Poojak",
                                    email = sessionStore.email()
                                        ?: error("Email missing."),
                                    message = request
                                )
                            }.getOrElse {
                                "Error: ${it.message ?: "Request failed."}"
                            }

                            messages += ChatMessage("assistant", reply)
                            loading = false
                        }
                    }
                ) {
                    Text(if (loading) "…" else "↑")
                }
            }
        }
    }
}
