package com.printalfa.backend.security;

import com.printalfa.backend.entity.User;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.Collections;
import java.util.UUID;

public class UserPrincipal implements UserDetails {

    private final UUID id;
    private final String email;
    private final String password;
    private final String role;
    private final UUID shopId;
    private final Collection<? extends GrantedAuthority> authorities;

    public UserPrincipal(UUID id, String email, String password, String role, UUID shopId, Collection<? extends GrantedAuthority> authorities) {
        this.id = id;
        this.email = email;
        this.password = password;
        this.role = role;
        this.shopId = shopId;
        this.authorities = authorities;
    }

    public static UserPrincipal create(User user) {
        GrantedAuthority authority = new SimpleGrantedAuthority(user.getRole().name());
        UUID shopId = user.getShop() != null ? user.getShop().getId() : null;

        return new UserPrincipal(
                user.getId(),
                user.getEmail(),
                user.getPassword(),
                user.getRole().name(),
                shopId,
                Collections.singletonList(authority)
        );
    }

    public UUID getId() { return id; }
    public String getRole() { return role; }
    public UUID getShopId() { return shopId; }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() { return authorities; }

    @Override
    public String getPassword() { return password; }

    @Override
    public String getUsername() { return email; }

    @Override
    public boolean isAccountNonExpired() { return true; }

    @Override
    public boolean isAccountNonLocked() { return true; }

    @Override
    public boolean isCredentialsNonExpired() { return true; }

    @Override
    public boolean isEnabled() { return true; }
}
