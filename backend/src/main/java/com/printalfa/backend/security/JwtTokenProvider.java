package com.printalfa.backend.security;

import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

@Component
public class JwtTokenProvider {

    @Value("${app.jwt.secret:}")
    private String jwtSecret;

    @Value("${app.jwt.expiration-ms:86400000}")
    private long jwtExpirationMs;

    private static final String DEFAULT_DEV_SECRET = "dev-only-local-secret-not-for-prod-0123456789abcdef";

    private SecretKey getSigningKey() {
        String secret = (jwtSecret != null && !jwtSecret.trim().isEmpty()) ? jwtSecret.trim() : DEFAULT_DEV_SECRET;
        return Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    public String generateToken(Authentication authentication) {
        return generateTokenWithSession(authentication, null);
    }

    public String generateTokenWithSession(Authentication authentication, String sessionId) {
        UserPrincipal userPrincipal = (UserPrincipal) authentication.getPrincipal();
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + jwtExpirationMs);

        JwtBuilder builder = Jwts.builder()
                .subject(userPrincipal.getUsername())
                .claim("shopId", userPrincipal.getShopId() != null ? userPrincipal.getShopId().toString() : null)
                .claim("role", userPrincipal.getRole())
                .issuedAt(now)
                .expiration(expiryDate)
                .signWith(getSigningKey());
                
        if (sessionId != null) {
            builder.claim("sessionId", sessionId);
        }

        return builder.compact();
    }

    public String getEmailFromToken(String token) {
        return getClaimsFromToken(token).getSubject();
    }

    public String getSessionIdFromToken(String token) {
        return getClaimsFromToken(token).get("sessionId", String.class);
    }

    private Claims getClaimsFromToken(String token) {
        return Jwts.parser()
                .verifyWith(getSigningKey())
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public boolean validateToken(String authToken) {
        try {
            Jwts.parser().verifyWith(getSigningKey()).build().parseSignedClaims(authToken);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }
}
