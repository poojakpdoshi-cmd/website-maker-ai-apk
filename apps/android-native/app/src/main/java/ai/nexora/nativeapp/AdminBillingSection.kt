package ai.nexora.nativeapp

import ai.nexora.nativeapp.data.AdminAccount
import ai.nexora.nativeapp.data.NexoraApi
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.launch

@Composable
internal fun AdminBillingSection(
    token: String,
    accounts: List<AdminAccount>,
    onReload: suspend () -> Unit
) {
    val scope = rememberCoroutineScope()
    var editingId by remember { mutableStateOf("") }
    var planId by remember { mutableStateOf("trial") }
    var status by remember { mutableStateOf("active") }
    var cycleEnd by remember { mutableStateOf("") }
    var tokenAdjustment by remember { mutableStateOf("0") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var errorText by remember { mutableStateOf("") }

    fun openEditor(account: AdminAccount) {
        editingId = account.id
        planId = account.planId.ifBlank { "trial" }
        status = account.subscriptionStatus.ifBlank { "active" }
        cycleEnd = account.cycleEnd.ifBlank {
            Instant.now()
                .plus(30, ChronoUnit.DAYS)
                .toString()
        }
        tokenAdjustment = "0"
        errorText = ""
        message = ""
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            GlassPanel(Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(5.dp)
                ) {
                    Text(
                        "Subscription & Token Billing",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Black
                    )
                    Text(
                        "Change plans, pause access, set renewal dates and add or deduct Nexora Tokens.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
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

        if (accounts.isEmpty() && !busy) {
            item {
                Text(
                    "No billing accounts found.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        items(accounts, key = { it.id }) { account ->
            GlassPanel(Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(7.dp)
                ) {
                    Text(
                        account.username,
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Black
                    )
                    Text(
                        account.internalEmail,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        "${account.planName.ifBlank { account.planId }} · " +
                            account.subscriptionStatus,
                        color = MaterialTheme.colorScheme.secondary
                    )
                    Text(
                        "Available: ${account.tokenBalance} · " +
                            "Monthly: ${account.monthlyBalance} · " +
                            "Top-up: ${account.topupBalance}"
                    )
                    Text(
                        "Reserved: ${account.reservedBalance} · " +
                            "Lifetime used: ${account.lifetimeUsed}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    if (account.cycleEnd.isNotBlank()) {
                        Text(
                            "Cycle ends: ${account.cycleEnd}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    if (editingId == account.id) {
                        Text(
                            "Plan",
                            fontWeight = FontWeight.Bold
                        )
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(
                                    rememberScrollState()
                                ),
                            horizontalArrangement =
                                Arrangement.spacedBy(6.dp)
                        ) {
                            listOf(
                                "trial" to "Trial",
                                "starter" to "Starter",
                                "pro" to "Pro",
                                "business" to "Business"
                            ).forEach { (value, label) ->
                                FilterChip(
                                    selected = planId == value,
                                    onClick = { planId = value },
                                    label = { Text(label) }
                                )
                            }
                        }

                        Text(
                            "Subscription status",
                            fontWeight = FontWeight.Bold
                        )
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(
                                    rememberScrollState()
                                ),
                            horizontalArrangement =
                                Arrangement.spacedBy(6.dp)
                        ) {
                            listOf(
                                "active",
                                "paused",
                                "cancelled",
                                "expired"
                            ).forEach { value ->
                                FilterChip(
                                    selected = status == value,
                                    onClick = { status = value },
                                    label = { Text(value) }
                                )
                            }
                        }

                        OutlinedTextField(
                            value = cycleEnd,
                            onValueChange = { cycleEnd = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = {
                                Text("Cycle end (ISO 8601)")
                            },
                            supportingText = {
                                Text("Example: 2026-08-22T00:00:00Z")
                            },
                            singleLine = true,
                            colors = nexoraOutlinedFieldColors()
                        )

                        OutlinedTextField(
                            value = tokenAdjustment,
                            onValueChange = { value ->
                                if (
                                    value.isBlank() ||
                                    value == "-" ||
                                    value.toIntOrNull() != null
                                ) {
                                    tokenAdjustment = value
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            label = {
                                Text("Token adjustment (+ add, - deduct)")
                            },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Number
                            ),
                            colors = nexoraOutlinedFieldColors()
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement =
                                Arrangement.spacedBy(8.dp)
                        ) {
                            Button(
                                modifier = Modifier.weight(1f),
                                enabled = !busy,
                                onClick = {
                                    val adjustment =
                                        tokenAdjustment.toIntOrNull()
                                    val validDate = runCatching {
                                        Instant.parse(cycleEnd)
                                    }.isSuccess

                                    if (!validDate) {
                                        errorText =
                                            "Enter a valid ISO renewal date."
                                        return@Button
                                    }

                                    if (adjustment == null) {
                                        errorText =
                                            "Enter a valid token adjustment."
                                        return@Button
                                    }

                                    busy = true
                                    errorText = ""
                                    message = ""
                                    scope.launch {
                                        try {
                                            NexoraApi.adminUpdateBilling(
                                                token = token,
                                                id = account.id,
                                                planId = planId,
                                                status = status,
                                                cycleEnd = cycleEnd,
                                                tokenAdjustment = adjustment
                                            )
                                            onReload()
                                            editingId = ""
                                            message =
                                                "Billing updated for ${account.username}."
                                        } catch (error: Throwable) {
                                            errorText = error.message
                                                ?: "Billing update failed."
                                        } finally {
                                            busy = false
                                        }
                                    }
                                }
                            ) {
                                Text("Save billing")
                            }

                            OutlinedButton(
                                modifier = Modifier.weight(1f),
                                enabled = !busy,
                                onClick = {
                                    editingId = ""
                                }
                            ) {
                                Text("Cancel")
                            }
                        }
                    } else {
                        OutlinedButton(
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !busy,
                            onClick = { openEditor(account) }
                        ) {
                            Text("Manage billing")
                        }
                    }
                }
            }
        }

        item {
            TextButton(
                enabled = !busy,
                onClick = {
                    busy = true
                    errorText = ""
                    scope.launch {
                        try {
                            onReload()
                        } catch (error: Throwable) {
                            errorText = error.message
                                ?: "Could not refresh billing."
                        } finally {
                            busy = false
                        }
                    }
                }
            ) {
                Text("Refresh billing accounts")
            }
        }
    }
}
