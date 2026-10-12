package com.printalfa.backend.repository;

import com.printalfa.backend.entity.UserSession;
import com.printalfa.backend.enums.SessionStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface UserSessionRepository extends JpaRepository<UserSession, UUID> {
    Optional<UserSession> findBySessionToken(String sessionToken);
    List<UserSession> findByUserIdAndStatus(UUID userId, SessionStatus status);
}
