package com.printalfa.backend.controller;

import com.printalfa.backend.dto.ApiResponse;
import com.printalfa.backend.dto.CreateOrderRequest;
import com.printalfa.backend.dto.OrderDTO;
import com.printalfa.backend.service.OrderService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/public/orders")
public class PublicOrderController {

    private final OrderService orderService;

    public PublicOrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @PostMapping
    public ResponseEntity<ApiResponse<OrderDTO>> createOrder(@Valid @RequestBody CreateOrderRequest request) {
        OrderDTO order = orderService.createOrder(request);
        return ResponseEntity.ok(ApiResponse.success("Print order created successfully", order));
    }

    @GetMapping("/{publicToken}")
    public ResponseEntity<ApiResponse<OrderDTO>> getOrderByPublicToken(@PathVariable UUID publicToken) {
        OrderDTO order = orderService.getOrderByPublicToken(publicToken);
        return ResponseEntity.ok(ApiResponse.success(order));
    }
}
