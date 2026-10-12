package com.printalfa.backend;

import com.printalfa.backend.entity.Shop;
import com.printalfa.backend.entity.User;
import com.printalfa.backend.enums.UserRole;
import com.printalfa.backend.repository.ShopRepository;
import com.printalfa.backend.repository.UserRepository;
import com.printalfa.backend.security.JwtTokenProvider;
import com.printalfa.backend.security.UserPrincipal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.messaging.converter.StringMessageConverter;
import org.springframework.messaging.simp.stomp.*;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import org.springframework.web.socket.sockjs.client.SockJsClient;
import org.springframework.web.socket.sockjs.client.Transport;
import org.springframework.web.socket.sockjs.client.WebSocketTransport;

import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
public class AdminWebSocketSecurityTest {

    @LocalServerPort
    private int port;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ShopRepository shopRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private Shop shopA;
    private Shop shopB;

    private String shopAToken;
    private String shopBToken;

    @BeforeEach
    void setUp() {
        shopA = shopRepository.save(new Shop("Shop A WS", "shop-a-ws-" + UUID.randomUUID(), "Address A", "1111111111", null));
        shopB = shopRepository.save(new Shop("Shop B WS", "shop-b-ws-" + UUID.randomUUID(), "Address B", "2222222222", null));

        User userA = new User();
        userA.setEmail("adminA_ws_" + UUID.randomUUID() + "@shop.com");
        userA.setPassword(passwordEncoder.encode("password"));
        userA.setRole(UserRole.ROLE_SHOP_ADMIN);
        userA.setShop(shopA);
        userA = userRepository.save(userA);

        User userB = new User();
        userB.setEmail("adminB_ws_" + UUID.randomUUID() + "@shop.com");
        userB.setPassword(passwordEncoder.encode("password"));
        userB.setRole(UserRole.ROLE_SHOP_ADMIN);
        userB.setShop(shopB);
        userB = userRepository.save(userB);

        UserPrincipal principalA = UserPrincipal.create(userA);
        Authentication authA = new UsernamePasswordAuthenticationToken(principalA, null, principalA.getAuthorities());
        shopAToken = jwtTokenProvider.generateToken(authA);

        UserPrincipal principalB = UserPrincipal.create(userB);
        Authentication authB = new UsernamePasswordAuthenticationToken(principalB, null, principalB.getAuthorities());
        shopBToken = jwtTokenProvider.generateToken(authB);
    }

    @Autowired
    private org.springframework.boot.test.web.client.TestRestTemplate restTemplate;

    @Test
    @DisplayName("SockJS info handshake endpoint /ws-admin/info returns 200 OK without 401 Unauthorized")
    void testSockJsInfoHandshakePermitted() {
        org.springframework.http.ResponseEntity<String> response =
                restTemplate.getForEntity("http://localhost:" + port + "/ws-admin/info", String.class);
        assertEquals(org.springframework.http.HttpStatus.OK, response.getStatusCode(),
                "SockJS handshake /ws-admin/info should return 200 OK");
        assertTrue(response.getBody() != null && response.getBody().contains("websocket"),
                "Response should contain SockJS info JSON with websocket:true");
    }

    @Test
    @DisplayName("STOMP connect with valid JWT and subscribe to own shop topic succeeds")
    void testStompConnectAndSubscribeOwnShop() throws Exception {
        WebSocketStompClient stompClient = createWebSocketClient();
        StompHeaders connectHeaders = new StompHeaders();
        connectHeaders.add("Authorization", "Bearer " + shopAToken);

        CompletableFuture<StompSession> sessionFuture = new CompletableFuture<>();

        stompClient.connectAsync("http://localhost:" + port + "/ws-admin", (org.springframework.web.socket.WebSocketHttpHeaders) null, connectHeaders, new StompSessionHandlerAdapter() {
            @Override
            public void afterConnected(StompSession session, StompHeaders connectedHeaders) {
                sessionFuture.complete(session);
            }

            @Override
            public void handleTransportError(StompSession session, Throwable exception) {
                sessionFuture.completeExceptionally(exception);
            }
        });

        StompSession session = sessionFuture.get(5, TimeUnit.SECONDS);
        assertNotNull(session, "STOMP session should be established");
        assertTrue(session.isConnected(), "STOMP session should be connected");

        // Subscribe to own shop orders topic
        StompHeaders subHeaders = new StompHeaders();
        subHeaders.setDestination("/topic/admin/shop/" + shopA.getId() + "/orders");

        StompSession.Subscription subscription = session.subscribe(subHeaders, new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return String.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
            }
        });

        assertNotNull(subscription, "Subscription to own shop topic should succeed");
        session.disconnect();
    }

    private WebSocketStompClient createWebSocketClient() {
        List<Transport> transports = new ArrayList<>(1);
        transports.add(new WebSocketTransport(new StandardWebSocketClient()));
        SockJsClient sockJsClient = new SockJsClient(transports);

        WebSocketStompClient stompClient = new WebSocketStompClient(sockJsClient);
        stompClient.setMessageConverter(new StringMessageConverter());
        return stompClient;
    }
}
