package com.printalfa.backend.dto;

import com.printalfa.backend.enums.PrintStatus;
import jakarta.validation.constraints.NotNull;

public class UpdatePrintStatusRequest {
    @NotNull(message = "Print status is required")
    private PrintStatus printStatus;

    public UpdatePrintStatusRequest() {}

    public UpdatePrintStatusRequest(PrintStatus printStatus) {
        this.printStatus = printStatus;
    }

    public PrintStatus getPrintStatus() { return printStatus; }
    public void setPrintStatus(PrintStatus printStatus) { this.printStatus = printStatus; }
}
