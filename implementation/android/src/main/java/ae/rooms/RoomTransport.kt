package ae.rooms

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.io.IOException
import java.util.concurrent.TimeUnit

class LiveClosed(val code: Int) : IOException("closed $code")

class RoomTransport(baseUrl: String) {
    private val live = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS).pingInterval(20, TimeUnit.SECONDS).build()
    private val wsBase = baseUrl.replaceFirst("http", "ws")

    fun connect(path: String, hello: String?, opened: (WebSocket?) -> Unit = {}): Flow<String> = callbackFlow {
        val ws = live.newWebSocket(Request.Builder().url(wsBase + path).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (hello != null) webSocket.send(hello)
                opened(webSocket)
            }
            override fun onMessage(webSocket: WebSocket, text: String) { if (text != "pong") trySend(text) }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                close(LiveClosed(code))
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { close(LiveClosed(code)) }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { close(t) }
        })
        val pinger = launch { while (true) { delay(25_000); ws.send("ping") } }
        awaitClose { pinger.cancel(); opened(null); ws.close(1000, null) }
    }
}
