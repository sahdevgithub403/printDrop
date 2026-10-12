package com.printalfa.backend;

import com.printalfa.backend.entity.Document;
import com.printalfa.backend.service.FileStorageService;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
public class DocumentPageCountAndStorageTest {

    @Autowired
    private FileStorageService fileStorageService;

    private byte[] createTestPdfBytes(int pagesCount) throws IOException {
        try (PDDocument doc = new PDDocument();
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            for (int i = 0; i < pagesCount; i++) {
                doc.addPage(new PDPage());
            }
            doc.save(baos);
            return baos.toByteArray();
        }
    }

    private byte[] createTestDocxBytes(int pagesCount) throws IOException {
        try (XWPFDocument doc = new XWPFDocument();
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            doc.createParagraph().createRun().setText("Sample document content");
            if (pagesCount > 0) {
                doc.getProperties().getExtendedProperties().getUnderlyingProperties().setPages(pagesCount);
            }
            doc.write(baos);
            return baos.toByteArray();
        }
    }

    private byte[] createTestPngBytes() throws IOException {
        BufferedImage image = new BufferedImage(10, 10, BufferedImage.TYPE_INT_RGB);
        try (ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            ImageIO.write(image, "png", baos);
            return baos.toByteArray();
        }
    }

    @Test
    void testSinglePagePdfUpload() throws Exception {
        byte[] pdfBytes = createTestPdfBytes(1);
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "single_page_resume.pdf",
                "application/pdf",
                pdfBytes
        );

        Document doc = fileStorageService.uploadFile(file);
        assertNotNull(doc);
        assertNotNull(doc.getId());
        assertEquals("single_page_resume.pdf", doc.getOriginalFileName());
        assertEquals(1, doc.getPageCount(), "Single page PDF should have page count 1");
    }

    @Test
    void testMultiPagePdfUpload() throws Exception {
        byte[] pdfBytes = createTestPdfBytes(7);
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "annual_report.pdf",
                "application/pdf",
                pdfBytes
        );

        Document doc = fileStorageService.uploadFile(file);
        assertNotNull(doc);
        assertEquals(7, doc.getPageCount(), "Multi-page PDF should accurately report 7 pages");
    }

    @Test
    void testSupportedMultiPageDocxUpload() throws Exception {
        byte[] docxBytes = createTestDocxBytes(4);
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "thesis_proposal.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                docxBytes
        );

        Document doc = fileStorageService.uploadFile(file);
        assertNotNull(doc);
        assertEquals(4, doc.getPageCount(), "Multi-page DOCX should read 4 pages from extended properties");
    }

    @Test
    void testImageFileUpload() throws Exception {
        byte[] pngBytes = createTestPngBytes();
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "id_photo.png",
                "image/png",
                pngBytes
        );

        Document doc = fileStorageService.uploadFile(file);
        assertNotNull(doc);
        assertEquals(1, doc.getPageCount(), "Image file should have page count 1");
    }

    @Test
    void testUnsupportedFileTypeRejection() {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "malicious_script.exe",
                "application/octet-stream",
                "MZ...fake exe content".getBytes()
        );

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> {
            fileStorageService.uploadFile(file);
        });
        assertTrue(ex.getMessage().contains("Unsupported file type"), "Should reject unsupported extension");
    }

    @Test
    void testCorruptedPdfHandling() {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "corrupted.pdf",
                "application/pdf",
                "This is not a valid PDF header or payload".getBytes()
        );

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> {
            fileStorageService.uploadFile(file);
        });
        assertTrue(ex.getMessage().contains("Invalid or corrupted PDF"), "Should reject corrupted PDF with meaningful error");
    }

    @Test
    void testCorruptedDocxHandling() {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "corrupted.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "Not a valid zip stream for docx".getBytes()
        );

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> {
            fileStorageService.uploadFile(file);
        });
        assertTrue(ex.getMessage().contains("Invalid or corrupted DOCX"), "Should reject corrupted DOCX with meaningful error");
    }
}
