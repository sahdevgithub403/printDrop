package com.printalfa.backend.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

import java.util.Arrays;

@Service
public class EmailService {
    
    private static final Logger logger = LoggerFactory.getLogger(EmailService.class);

    @Autowired(required = false)
    private JavaMailSender mailSender;

    @Value("${spring.profiles.active:dev}")
    private String activeProfile;

    @Value("${app.mail.enabled:false}")
    private boolean mailEnabled;

    /**
     * Sends the password-reset email.
     *
     * @return true if the email was actually handed to the mail sender, false when
     *         mail is not configured (dev mode logs the token instead).
     * @throws IllegalStateException when mail is configured but delivery fails.
     */
    public boolean sendPasswordResetEmail(String to, String resetToken) {
        String subject = "PrintAlfa - Password Reset";
        String text = "You have requested to reset your password.\n\n" +
                "Use the following token to reset your password:\n" +
                resetToken + "\n\n" +
                "This token will expire in 1 hour.\n" +
                "If you did not request a password reset, please ignore this email.";

        // H-16: mail sends only when explicitly enabled (app.mail.enabled=true).
        // Otherwise log-only and report "not sent" so callers fail honestly (503).
        if (!mailEnabled || mailSender == null) {
            logger.info("MAIL DISABLED (app.mail.enabled={}) - Password Reset Email to {}:\nSubject: {}\n{}",
                    mailEnabled, to, subject, text);
            // H-16: fail honestly — disabled/unconfigured mail does NOT actually deliver email.
            return false;
        }
        try {
            SimpleMailMessage message = new SimpleMailMessage();
            message.setTo(to);
            message.setSubject(subject);
            message.setText(text);
            mailSender.send(message);
            logger.info("Sent password reset email to {}", to);
            return true;
        } catch (Exception e) {
            logger.error("Failed to send password reset email to {}", to, e);
            throw new IllegalStateException("Failed to send password reset email", e);
        }
    }
}
