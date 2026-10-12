package com.printalfa.backend.controller;

import com.printalfa.backend.dto.ApiResponse;
import com.printalfa.backend.dto.AuthRequest;
import com.printalfa.backend.dto.AuthResponse;
import com.printalfa.backend.dto.SignupRequest;
import com.printalfa.backend.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public ResponseEntity<ApiResponse<AuthResponse>> login(@Valid @RequestBody AuthRequest request,
                                                           @RequestHeader(value = "X-Device-ID", required = false) String deviceId,
                                                           @RequestHeader(value = "X-Device-Name", required = false) String deviceName,
                                                           @RequestHeader(value = "X-App-Version", required = false) String appVersion) {
        AuthResponse response = authService.login(request, deviceId, deviceName, appVersion);
        return ResponseEntity.ok(ApiResponse.success("Login successful", response));
    }

    @PostMapping("/signup")
    public ResponseEntity<ApiResponse<AuthResponse>> signup(@Valid @RequestBody SignupRequest request,
                                                            @RequestHeader(value = "X-Device-ID", required = false) String deviceId,
                                                            @RequestHeader(value = "X-Device-Name", required = false) String deviceName,
                                                            @RequestHeader(value = "X-App-Version", required = false) String appVersion) {
        AuthResponse response = authService.signup(request, deviceId, deviceName, appVersion);
        return ResponseEntity.ok(ApiResponse.success("Signup successful", response));
    }

    @PostMapping("/forgot-password")
    public ResponseEntity<ApiResponse<String>> forgotPassword(@RequestBody Map<String, String> body) {
        String email = body.get("email");
        if (email == null || email.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(ApiResponse.error("Email is required"));
        }
        // H-16: success only if sent; mail failures for existing accounts
        // surface as 503 from the service (unknown emails stay generic success).
        authService.forgotPassword(email);
        return ResponseEntity.ok(ApiResponse.success("If an account exists with this email, a reset link has been sent.", null));
    }

    @PostMapping("/reset-password")
    public ResponseEntity<ApiResponse<String>> resetPassword(@RequestBody Map<String, String> body) {
        String token = body.get("token");
        String newPassword = body.get("newPassword");

        if (token == null || newPassword == null || newPassword.length() < 8) {
            return ResponseEntity.badRequest().body(ApiResponse.error("Valid token and new password (min 8 chars) are required"));
        }
        
        authService.resetPassword(token, newPassword);
        return ResponseEntity.ok(ApiResponse.success("Password has been reset successfully. Please login again.", null));
    }
}
