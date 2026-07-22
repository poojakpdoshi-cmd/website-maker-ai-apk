package ai.nexora.nativeapp.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val NexoraNeon = darkColorScheme(
    primary = Color(0xFF5DEBFF),
    onPrimary = Color(0xFF001217),
    primaryContainer = Color(0xFF0A4154),
    onPrimaryContainer = Color(0xFFC4F5FF),

    secondary = Color(0xFFA98BFF),
    onSecondary = Color(0xFF19004A),
    secondaryContainer = Color(0xFF39226F),
    onSecondaryContainer = Color(0xFFE8DFFF),

    tertiary = Color(0xFFFF66D8),
    onTertiary = Color(0xFF3A0030),

    background = Color(0xFF02030A),
    onBackground = Color(0xFFF8F7FF),

    surface = Color(0xFF0A0F21),
    onSurface = Color(0xFFF8F7FF),

    surfaceVariant = Color(0xFF151B35),
    onSurfaceVariant = Color(0xFFC8CBE0),

    outline = Color(0xFF6F7BA8),
    error = Color(0xFFFF6F85)
)

@Composable
fun NexoraTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = NexoraNeon,
        typography = MaterialTheme.typography,
        content = content
    )
}
