package com.printalfa.backend.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.printalfa.backend.dto.ApiResponse;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.annotation.web.configurers.HeadersConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.List;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    private final CustomUserDetailsService userDetailsService;
    private final JwtTokenProvider tokenProvider;
    private final com.printalfa.backend.repository.ShopRepository shopRepository;
    private final com.printalfa.backend.repository.UserSessionRepository userSessionRepository;

    @Value("${app.cors.allowed-origins}")
    private String allowedOrigins;

    public SecurityConfig(CustomUserDetailsService userDetailsService,
                          JwtTokenProvider tokenProvider,
                          com.printalfa.backend.repository.ShopRepository shopRepository,
                          com.printalfa.backend.repository.UserSessionRepository userSessionRepository) {
        this.userDetailsService = userDetailsService;
        this.tokenProvider = tokenProvider;
        this.shopRepository = shopRepository;
        this.userSessionRepository = userSessionRepository;
    }

    @Bean
    public JwtAuthenticationFilter jwtAuthenticationFilter() {
        return new JwtAuthenticationFilter(tokenProvider, userDetailsService, userSessionRepository);
    }

    @Bean
    public PrintAgentApiKeyFilter printAgentApiKeyFilter() {
        return new PrintAgentApiKeyFilter(shopRepository);
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration authenticationConfiguration) throws Exception {
        return authenticationConfiguration.getAuthenticationManager();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .csrf(AbstractHttpConfigurer::disable)
            // H-15/H-16: keep frame-options protection enabled in all non-test profiles
            // (H2 console access is granted only by the test-profile security config).
            .headers(headers -> headers.frameOptions(HeadersConfigurer.FrameOptionsConfig::sameOrigin))
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .exceptionHandling(exceptions -> exceptions
                .authenticationEntryPoint((request, response, authException) -> {
                    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                    response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                    ApiResponse<?> apiResponse = ApiResponse.error("Unauthorized access: " + authException.getMessage());
                    new ObjectMapper().findAndRegisterModules().writeValue(response.getOutputStream(), apiResponse);
                })
                .accessDeniedHandler((request, response, accessDeniedException) -> {
                    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                    response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                    ApiResponse<?> apiResponse = ApiResponse.error("Forbidden access: " + accessDeniedException.getMessage());
                    new ObjectMapper().findAndRegisterModules().writeValue(response.getOutputStream(), apiResponse);
                })
            )
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                .requestMatchers("/api/auth/**").permitAll()
                .requestMatchers("/api/public/**").permitAll()
                .requestMatchers("/ws-admin/**").permitAll()
                .requestMatchers("/error").permitAll()
                // L-01: removed dead "SHOP_ADMIN" authority (canonical roles only).
                .requestMatchers("/api/print-agent/**").hasAnyAuthority("ROLE_PRINT_AGENT", "ROLE_SHOP_ADMIN", "ROLE_SUPER_ADMIN")
                .requestMatchers("/api/admin/**").hasAnyAuthority("ROLE_SHOP_ADMIN", "ROLE_SUPER_ADMIN")
                .anyRequest().authenticated()
            );

        http.addFilterBefore(jwtAuthenticationFilter(), UsernamePasswordAuthenticationFilter.class);
        http.addFilterBefore(printAgentApiKeyFilter(), JwtAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        
        List<String> origins = (allowedOrigins != null && !allowedOrigins.trim().isEmpty())
                ? Arrays.stream(allowedOrigins.split(","))
                        .map(String::trim)
                        .filter(s -> !s.isEmpty())
                        .toList()
                : List.of("http://localhost:*", "http://127.0.0.1:*", "http://localhost:5173", "http://localhost:5174", "http://localhost:5175");

        configuration.setAllowedOriginPatterns(origins);
        configuration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("*"));
        configuration.setExposedHeaders(List.of("Authorization", "Content-Disposition"));
        configuration.setAllowCredentials(true);

        CorsConfiguration wsConfiguration = new CorsConfiguration();
        // H-05/H-06: no wildcard+credentials — reuse the configured allowed origins.
        wsConfiguration.setAllowedOriginPatterns(origins);
        wsConfiguration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        wsConfiguration.setAllowedHeaders(List.of("*"));
        wsConfiguration.setExposedHeaders(List.of("Authorization", "Content-Disposition"));
        wsConfiguration.setAllowCredentials(true);
        
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/ws-admin/**", wsConfiguration);
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
