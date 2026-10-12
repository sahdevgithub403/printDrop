package com.printalfa.backend.security;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.Collections;
import java.util.UUID;

public class PrintAgentPrincipal implements UserDetails {

    private final UUID shopId;
    private final String shopSlug;
    private final String apiKey;
    private final Collection<? extends GrantedAuthority> authorities;

    public PrintAgentPrincipal(UUID shopId, String shopSlug, String apiKey) {
        this.shopId = shopId;
        this.shopSlug = shopSlug;
        this.apiKey = apiKey;
        this.authorities = Collections.singletonList(new SimpleGrantedAuthority("ROLE_PRINT_AGENT"));
    }

    public UUID getShopId() { return shopId; }
    public String getShopSlug() { return shopSlug; }
    public String getApiKey() { return apiKey; }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() { return authorities; }

    @Override
    public String getPassword() { return ""; }

    @Override
    public String getUsername() { return "agent:" + shopSlug; }

    @Override
    public boolean isAccountNonExpired() { return true; }

    @Override
    public boolean isAccountNonLocked() { return true; }

    @Override
    public boolean isCredentialsNonExpired() { return true; }

    @Override
    public boolean isEnabled() { return true; }
}
