package com.printalfa.backend.security;

import com.printalfa.backend.entity.Shop;
import com.printalfa.backend.repository.ShopRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Optional;

public class PrintAgentApiKeyFilter extends OncePerRequestFilter {

    private final ShopRepository shopRepository;

    public PrintAgentApiKeyFilter(ShopRepository shopRepository) {
        this.shopRepository = shopRepository;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        try {
            if (SecurityContextHolder.getContext().getAuthentication() == null) {
                String apiKey = extractApiKey(request);
                if (StringUtils.hasText(apiKey)) {
                    Optional<Shop> shopOpt = shopRepository.findByApiKey(apiKey.trim());
                    if (shopOpt.isPresent()) {
                        Shop shop = shopOpt.get();
                        PrintAgentPrincipal principal = new PrintAgentPrincipal(shop.getId(), shop.getSlug(), shop.getApiKey());
                        UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                                principal, null, principal.getAuthorities());
                        auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                        SecurityContextHolder.getContext().setAuthentication(auth);
                    }
                }
            }
        } catch (Exception ex) {
            logger.error("Could not authenticate print agent via API key", ex);
        }

        filterChain.doFilter(request, response);
    }

    private String extractApiKey(HttpServletRequest request) {
        String apiKey = request.getHeader("X-Agent-Key");
        if (StringUtils.hasText(apiKey)) {
            return apiKey;
        }
        apiKey = request.getHeader("X-API-Key");
        if (StringUtils.hasText(apiKey)) {
            return apiKey;
        }
        String authHeader = request.getHeader("Authorization");
        if (StringUtils.hasText(authHeader) && authHeader.startsWith("ApiKey ")) {
            return authHeader.substring(7);
        }
        return null;
    }
}
