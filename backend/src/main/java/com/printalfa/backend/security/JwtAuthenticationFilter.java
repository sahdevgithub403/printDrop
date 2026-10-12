package com.printalfa.backend.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenProvider tokenProvider;
    private final CustomUserDetailsService customUserDetailsService;
    private final com.printalfa.backend.repository.UserSessionRepository userSessionRepository;

    public JwtAuthenticationFilter(JwtTokenProvider tokenProvider, CustomUserDetailsService customUserDetailsService, com.printalfa.backend.repository.UserSessionRepository userSessionRepository) {
        this.tokenProvider = tokenProvider;
        this.customUserDetailsService = customUserDetailsService;
        this.userSessionRepository = userSessionRepository;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String jwt = getJwtFromRequest(request);

        if (StringUtils.hasText(jwt)) {
            // M-03/M-07: invalid, expired, or revoked tokens must yield 401 —
            // never silently continue as an unauthenticated request.
            if (!tokenProvider.validateToken(jwt)) {
                unauthorized(response, "Invalid or expired token");
                return;
            }
            try {
                String sessionId = tokenProvider.getSessionIdFromToken(jwt);
                if (sessionId != null) {
                    com.printalfa.backend.entity.UserSession userSession = userSessionRepository.findBySessionToken(sessionId).orElse(null);
                    if (userSession == null || userSession.getStatus() != com.printalfa.backend.enums.SessionStatus.ACTIVE || userSession.getExpiresAt().isBefore(java.time.LocalDateTime.now())) {
                        unauthorized(response, "Session is invalid or expired");
                        return;
                    }
                    request.setAttribute("USER_SESSION_ID", userSession.getId());
                }

                String email = tokenProvider.getEmailFromToken(jwt);
                UserDetails userDetails = customUserDetailsService.loadUserByUsername(email);

                UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
                        userDetails, null, userDetails.getAuthorities());
                authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));

                SecurityContextHolder.getContext().setAuthentication(authentication);
            } catch (Exception ex) {
                logger.error("Could not set user authentication in security context", ex);
                unauthorized(response, "Invalid or expired token");
                return;
            }
        }

        filterChain.doFilter(request, response);
    }

    private void unauthorized(HttpServletResponse response, String message) throws IOException {
        response.setContentType("application/json");
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.getWriter().write("{\"success\":false,\"message\":\"" + message + "\",\"data\":null}");
    }

    private String getJwtFromRequest(HttpServletRequest request) {
        String bearerToken = request.getHeader("Authorization");
        if (StringUtils.hasText(bearerToken) && bearerToken.startsWith("Bearer ")) {
            return bearerToken.substring(7);
        }
        return null;
    }
}
