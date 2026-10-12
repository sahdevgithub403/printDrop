package com.printalfa.backend.config;

import com.printalfa.backend.security.CustomUserDetailsService;
import com.printalfa.backend.security.JwtTokenProvider;
import com.printalfa.backend.security.UserPrincipal;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

import java.security.Principal;
import java.util.Arrays;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final JwtTokenProvider jwtTokenProvider;
    private final CustomUserDetailsService customUserDetailsService;
    private final com.printalfa.backend.repository.UserSessionRepository userSessionRepository;

    @org.springframework.beans.factory.annotation.Value("${app.cors.allowed-origins:}")
    private String allowedOrigins;

    public WebSocketConfig(JwtTokenProvider jwtTokenProvider, CustomUserDetailsService customUserDetailsService,
                           com.printalfa.backend.repository.UserSessionRepository userSessionRepository) {
        this.jwtTokenProvider = jwtTokenProvider;
        this.customUserDetailsService = customUserDetailsService;
        this.userSessionRepository = userSessionRepository;
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        config.enableSimpleBroker("/topic");
        config.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // H-05/H-06: never wildcard origins together with credentials — use the configured list.
        String[] patterns = (allowedOrigins != null && !allowedOrigins.trim().isEmpty())
                ? Arrays.stream(allowedOrigins.split(",")).map(String::trim)
                        .filter(s -> !s.isEmpty()).toArray(String[]::new)
                : new String[]{"http://localhost:5173", "http://localhost:5174", "http://localhost:5175"};
        // Native STOMP over standard WebSocket endpoint (used by @stomp/stompjs brokerURL)
        registry.addEndpoint("/ws-admin")
                .setAllowedOriginPatterns(patterns);

        // SockJS fallback endpoint
        registry.addEndpoint("/ws-admin")
                .setAllowedOriginPatterns(patterns)
                .withSockJS();
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
                if (accessor != null) {
                    if (StompCommand.CONNECT.equals(accessor.getCommand())) {
                        // H-05/H-06: CONNECT requires a valid, active-session JWT — fail closed.
                        String authHeader = accessor.getFirstNativeHeader("Authorization");
                        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
                            throw new AccessDeniedException("Missing WebSocket credentials");
                        }
                        String token = authHeader.substring(7);
                        if (!jwtTokenProvider.validateToken(token)) {
                            throw new AccessDeniedException("Invalid WebSocket credentials");
                        }
                        String email = jwtTokenProvider.getEmailFromToken(token);
                        UserDetails userDetails = customUserDetailsService.loadUserByUsername(email);
                        String sessionToken = jwtTokenProvider.getSessionIdFromToken(token);
                        if (sessionToken != null) {
                            boolean active = userSessionRepository.findBySessionToken(sessionToken)
                                    .map(s -> s.getStatus() == com.printalfa.backend.enums.SessionStatus.ACTIVE
                                            && s.getExpiresAt() != null
                                            && s.getExpiresAt().isAfter(java.time.LocalDateTime.now()))
                                    .orElse(false);
                            if (!active) {
                                throw new AccessDeniedException("WebSocket session is invalid or expired");
                            }
                        }
                        UsernamePasswordAuthenticationToken authentication =
                                new UsernamePasswordAuthenticationToken(userDetails, null, userDetails.getAuthorities());
                        accessor.setUser(authentication);
                    } else if (StompCommand.SUBSCRIBE.equals(accessor.getCommand())
                            || StompCommand.SEND.equals(accessor.getCommand())) {
                        // H-05/H-06: every SUBSCRIBE/SEND must carry an authenticated, tenant-scoped principal.
                        String destination = accessor.getDestination();
                        Principal principal = accessor.getUser();
                        if (principal == null) {
                            throw new AccessDeniedException("Unauthorized WebSocket frame: authentication required");
                        }
                        if (destination != null && destination.startsWith("/topic/admin/shop/")) {
                            if (principal == null) {
                                throw new AccessDeniedException("Unauthorized WebSocket subscription");
                            }
                            if (principal instanceof Authentication auth && auth.getPrincipal() instanceof UserPrincipal userPrincipal) {
                                boolean isSuperAdmin = userPrincipal.getAuthorities().stream()
                                        .anyMatch(a -> a.getAuthority().equals("ROLE_SUPER_ADMIN"));
                                if (!isSuperAdmin) {
                                    String requiredPrefix = "/topic/admin/shop/" + userPrincipal.getShopId() + "/";
                                    if (!destination.startsWith(requiredPrefix)) {
                                        throw new AccessDeniedException("Forbidden WebSocket subscription to other shop");
                                    }
                                }
                            } else {
                                throw new AccessDeniedException("Unauthorized principal for WebSocket subscription");
                            }
                        }
                    }
                }
                return message;
            }
        });
    }
}
