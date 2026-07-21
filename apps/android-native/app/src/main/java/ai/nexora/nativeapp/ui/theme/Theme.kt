package ai.nexora.nativeapp.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val NexoraDark = darkColorScheme(
    primary = Color(0xFF54D8FF),
    onPrimary = Color(0xFF00141C),
    primaryContainer = Color(0xFF073A4A),
    onPrimaryContainer = Color(0xFFB6EEFF),
    secondary = Color(0xFFB39BFF),
    onSecondary = Color(0xFF1E0B52),
    secondaryContainer = Color(0xFF32236A),
    onSecondaryContainer = Color(0xFFE5DEFF),
    tertiary = Color(0xFFFF8BD8),
    background = Color(0xFF020512),
    onBackground = Color(0xFFF6F7FF),
    surface = Color(0xFF080D20),
    onSurface = Color(0xFFF6F7FF),
    surfaceVariant = Color(0xFF121B38),
    onSurfaceVariant = Color(0xFFC5CAE0),
    outline = Color(0xFF7782A7),
    error = Color(0xFFFF6B7E)
)

@Composable fun NexoraTheme(content:@Composable ()->Unit){
    MaterialTheme(colorScheme=NexoraDark,typography=MaterialTheme.typography,content=content)
}
