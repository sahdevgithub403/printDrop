package com.printalfa.backend.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;

@Service
public class WebSocketService {

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    public void sendOrderUpdate(UUID shopId, Map<String, Object> event) {
        // H-05/H-06: publish only after the surrounding transaction commits,
        // so subscribers never observe uncommitted (phantom) order updates.
        if (org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive()) {
            UUID capturedShopId = shopId;
            Map<String, Object> capturedEvent = event;
            org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                    new org.springframework.transaction.support.TransactionSynchronization() {
                        @Override
                        public void afterCommit() {
                            messagingTemplate.convertAndSend(
                                    "/topic/admin/shop/" + capturedShopId + "/orders", capturedEvent);
                        }
                    });
        } else {
            String destination = "/topic/admin/shop/" + shopId + "/orders";
            messagingTemplate.convertAndSend(destination, event);
        }
    }
}
