package com.printalfa.backend.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.Arrays;

/**
 * C-03: fail-fast startup validation for required secrets.
 *
 * <p>The default (prod-like) profile ships with NO production-capable defaults
 * for the JWT secret, DB password, or Razorpay keys ({@code ${VAR:}} blanks in
 * application.yml). When neither the {@code dev} nor {@code test} profile is
 * active, missing identity/data secrets abort startup with a clear message
 * instead of booting insecurely. Localhost conveniences live ONLY in the
 * clearly-marked dev/test profile sections.
 *
 * <p>Razorpay keys are intentionally warning-only: PAY_AT_SHOP-only deployments
 * legitimately run without them, and ONLINE payment paths fail closed (503) at
 * runtime when keys are absent.
 */
@Component
@Order(1)
public class RequiredEnvValidator implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(RequiredEnvValidator.class);

    private final Environment environment;

    @Value("${app.jwt.secret:}")
    private String jwtSecret;

    @Value("${spring.datasource.password:}")
    private String dbPassword;

    @Value("${app.cors.allowed-origins:}")
    private String corsOrigins;

    @Value("${razorpay.key-id:}")
    private String razorpayKeyId;

    @Value("${razorpay.key-secret:}")
    private String razorpayKeySecret;

    public RequiredEnvValidator(Environment environment) {
        this.environment = environment;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (Arrays.asList(environment.getActiveProfiles()).contains("dev")
                || Arrays.asList(environment.getActiveProfiles()).contains("test")) {
            log.info("RequiredEnvValidator skipped (dev/test profile active)");
            return;
        }

        StringBuilder missing = new StringBuilder();
        if (jwtSecret == null || jwtSecret.isBlank()) {
            missing.append(" APP_JWT_SECRET");
        } else if (jwtSecret.length() < 32) {
            throw new IllegalStateException(
                    "RequiredEnvValidator: APP_JWT_SECRET must be at least 32 characters for HS256 signing");
        }
        if (dbPassword == null || dbPassword.isBlank()) {
            missing.append(" SPRING_DATASOURCE_PASSWORD");
        }
        if (corsOrigins == null || corsOrigins.isBlank()) {
            missing.append(" APP_CORS_ALLOWED_ORIGINS");
        }
        if (missing.length() > 0) {
            throw new IllegalStateException(
                    "RequiredEnvValidator: missing required secrets in prod profile:"
                            + missing + ". Set them via environment variables (see application.yml).");
        }

        if (razorpayKeyId == null || razorpayKeyId.isBlank()
                || razorpayKeySecret == null || razorpayKeySecret.isBlank()) {
            log.warn("RequiredEnvValidator: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are blank — "
                    + "ONLINE payments will fail closed (503) until configured. PAY_AT_SHOP is unaffected.");
        }
        log.info("RequiredEnvValidator: required secrets present");
    }
}
