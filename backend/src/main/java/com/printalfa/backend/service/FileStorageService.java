package com.printalfa.backend.service;

import com.printalfa.backend.entity.Document;
import com.printalfa.backend.repository.DocumentRepository;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.poi.hpsf.SummaryInformation;
import org.apache.poi.hwpf.HWPFDocument;
import org.apache.poi.ooxml.POIXMLProperties;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.net.MalformedURLException;
import java.nio.file.*;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

@Service
public class FileStorageService {

    private final Path fileStorageLocation;
    private final DocumentRepository documentRepository;

    private static final List<String> ALLOWED_EXTENSIONS = Arrays.asList("pdf", "jpg", "jpeg", "png", "doc", "docx");
    // Document Studio edited copies may only be produced in renderable formats.
    private static final List<String> EDITED_COPY_EXTENSIONS = Arrays.asList("pdf", "jpg", "jpeg", "png");
    private static final long MAX_EDITED_COPY_BYTES = 20L * 1024 * 1024;
    private static final int MAX_PDF_PAGES = 2000;
    // Rough text-based page estimate fallback (~1800 chars per page).
    private static final int CHARS_PER_PAGE_ESTIMATE = 1800;

    public FileStorageService(@Value("${app.upload.dir:./uploads}") String uploadDir, DocumentRepository documentRepository) {
        this.documentRepository = documentRepository;
        this.fileStorageLocation = Paths.get(uploadDir).toAbsolutePath().normalize();

        try {
            Files.createDirectories(this.fileStorageLocation);
        } catch (Exception ex) {
            throw new RuntimeException("Could not create directory for uploaded files.", ex);
        }
    }

    public Document uploadFile(MultipartFile file) {
        return uploadFile(file, null);
    }

    public Document uploadFile(MultipartFile file, java.util.UUID shopId) {
        String originalFileName = StringUtils.cleanPath(file.getOriginalFilename());
        
        if (originalFileName.contains("..")) {
            throw new IllegalArgumentException("Filename contains invalid path sequence " + originalFileName);
        }

        String extension = getFileExtension(originalFileName).toLowerCase();
        if (!ALLOWED_EXTENSIONS.contains(extension)) {
            throw new IllegalArgumentException("Unsupported file type: ." + extension + ". Allowed formats: PDF, JPG, PNG, DOC, DOCX.");
        }

        String storedFileName = UUID.randomUUID().toString() + "." + extension;
        Path targetLocation = this.fileStorageLocation.resolve(storedFileName);

        // M-06: magic-byte content check — extension alone is not trustworthy.
        try {
            verifyMagicBytes(file.getInputStream(), extension, originalFileName);
        } catch (IOException ex) {
            throw new IllegalArgumentException("Failed to read uploaded file " + originalFileName, ex);
        }

        try {
            Files.copy(file.getInputStream(), targetLocation, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException ex) {
            throw new RuntimeException("Failed to store file " + originalFileName, ex);
        }

        int pageCount;
        try {
            pageCount = calculatePageCount(targetLocation.toFile(), extension, originalFileName);
        } catch (Exception ex) {
            try {
                Files.deleteIfExists(targetLocation);
            } catch (IOException ignored) {}
            if (ex instanceof IllegalArgumentException) {
                throw (IllegalArgumentException) ex;
            }
            throw new IllegalArgumentException("Failed to process document " + originalFileName + ": " + ex.getMessage(), ex);
        }

        Document doc = new Document(
                originalFileName,
                storedFileName,
                file.getContentType(),
                file.getSize(),
                pageCount,
                // L-02: store the relative stored file name, not an absolute FS path.
                storedFileName
        );
        doc.setShopId(shopId);

        return documentRepository.save(doc);
    }

    /**
     * Stores bytes produced by Document Studio (edited PDF/image export).
     * Same guarantees as uploads: extension allowlist, magic-byte sniff,
     * server-side UUID filename, page-count validation, shop + lineage binding.
     * The original file is never touched.
     */
    public Document storeGeneratedBytes(byte[] data, String originalFileName, String contentType,
                                        java.util.UUID shopId, java.util.UUID parentDocumentId) {
        if (data == null || data.length < 4) {
            throw new IllegalArgumentException("Generated file is empty or unreadable");
        }
        if (data.length > MAX_EDITED_COPY_BYTES) {
            throw new IllegalArgumentException("Generated file exceeds the maximum allowed size of 20 MB");
        }
        String cleanName = originalFileName != null ? StringUtils.cleanPath(originalFileName.trim()) : "";
        if (cleanName.isEmpty() || cleanName.contains("..")) {
            throw new IllegalArgumentException("Invalid generated file name");
        }
        String extension = getFileExtension(cleanName).toLowerCase();
        if (!EDITED_COPY_EXTENSIONS.contains(extension)) {
            throw new IllegalArgumentException("Unsupported edited output type: ." + extension + ". Allowed: PDF, JPG, PNG.");
        }
        try {
            verifyMagicBytes(new java.io.ByteArrayInputStream(data), extension, cleanName);
        } catch (IOException ex) {
            throw new IllegalArgumentException("Failed to read generated file " + cleanName, ex);
        }

        String storedFileName = UUID.randomUUID().toString() + "." + extension;
        Path targetLocation = this.fileStorageLocation.resolve(storedFileName);
        try {
            Files.copy(new java.io.ByteArrayInputStream(data), targetLocation, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException ex) {
            throw new RuntimeException("Failed to store generated file " + cleanName, ex);
        }

        int pageCount;
        try {
            pageCount = calculatePageCount(targetLocation.toFile(), extension, cleanName);
        } catch (Exception ex) {
            try {
                Files.deleteIfExists(targetLocation);
            } catch (IOException ignored) {}
            if (ex instanceof IllegalArgumentException) {
                throw (IllegalArgumentException) ex;
            }
            throw new IllegalArgumentException("Failed to process generated file " + cleanName + ": " + ex.getMessage(), ex);
        }

        Document doc = new Document(
                cleanName,
                storedFileName,
                contentType != null ? contentType : ("pdf".equals(extension) ? "application/pdf" : "image/" + extension),
                data.length,
                pageCount,
                storedFileName
        );
        doc.setShopId(shopId);
        doc.setParentDocumentId(parentDocumentId);
        return documentRepository.save(doc);
    }

    /**
     * Minimal magic-byte sniff for pdf/png/jpg plus OLE/OOXML container check for
     * doc/docx. POI parsing in calculatePageCount remains the final validator.
     */
    private void verifyMagicBytes(java.io.InputStream in, String extension, String originalFileName) throws IOException {
        byte[] header = new byte[8];
        int read;
        try (java.io.BufferedInputStream bin = new java.io.BufferedInputStream(in)) {
            bin.mark(16);
            read = bin.read(header, 0, header.length);
            bin.reset();
        }
        if (read < 4) {
            throw new IllegalArgumentException("Invalid or corrupted file (empty or unreadable): " + originalFileName);
        }
        // Error wording mirrors calculatePageCount so callers see consistent messages.
        switch (extension) {
            case "pdf": {
                boolean ok = header[0] == 0x25 && header[1] == 0x50 && header[2] == 0x44 && header[3] == 0x46; // %PDF
                if (!ok) {
                    throw new IllegalArgumentException("Invalid or corrupted PDF file: " + originalFileName);
                }
                break;
            }
            case "png":
            case "jpg":
            case "jpeg": {
                boolean ok;
                if ("png".equals(extension)) {
                    ok = (header[0] & 0xFF) == 0x89 && header[1] == 0x50 && header[2] == 0x4E && header[3] == 0x47; // PNG
                } else {
                    ok = (header[0] & 0xFF) == 0xFF && (header[1] & 0xFF) == 0xD8 && (header[2] & 0xFF) == 0xFF; // JPEG SOI
                }
                if (!ok) {
                    throw new IllegalArgumentException("Invalid or unreadable image file: " + originalFileName);
                }
                break;
            }
            case "doc": {
                // OLE compound document: D0 CF 11 E0 A1 B1 1A E1
                boolean ok = read >= 8
                        && (header[0] & 0xFF) == 0xD0 && (header[1] & 0xFF) == 0xCF
                        && (header[2] & 0xFF) == 0x11 && (header[3] & 0xFF) == 0xE0
                        && (header[4] & 0xFF) == 0xA1 && (header[5] & 0xFF) == 0xB1
                        && (header[6] & 0xFF) == 0x1A && (header[7] & 0xFF) == 0xE1;
                if (!ok) {
                    throw new IllegalArgumentException("Invalid or corrupted DOC file: " + originalFileName);
                }
                break;
            }
            case "docx": {
                // OOXML is a ZIP archive: PK\x03\x04 (allow empty-span variants PK\x05\x06 / PK\x07\x08)
                boolean ok = read >= 4 && header[0] == 0x50 && header[1] == 0x4B
                        && (header[2] == 0x03 || header[2] == 0x05 || header[2] == 0x07);
                if (!ok) {
                    throw new IllegalArgumentException("Invalid or corrupted DOCX file: " + originalFileName);
                }
                break;
            }
            default:
                break; // unreachable: extension allowlist enforced by caller
        }
    }

    public boolean deletePhysicalFile(String storedFileName) {
        if (storedFileName == null || storedFileName.contains("..") || storedFileName.contains("/") || storedFileName.contains("\\")) {
            throw new IllegalArgumentException("Invalid stored file name for deletion");
        }
        try {
            Path filePath = this.fileStorageLocation.resolve(storedFileName).normalize();
            if (!filePath.startsWith(this.fileStorageLocation)) {
                throw new SecurityException("Cannot delete file outside upload directory");
            }
            // Idempotent: an already-absent file counts as success so DB cleanup can proceed.
            if (!Files.exists(filePath)) {
                return true;
            }
            try {
                Files.delete(filePath);
                return true;
            } catch (java.nio.file.NoSuchFileException e) {
                return true;
            }
        } catch (IOException ex) {
            org.slf4j.LoggerFactory.getLogger(FileStorageService.class)
                    .warn("Failed to delete physical file {}: {}", storedFileName, ex.getMessage());
            return false;
        }
    }

    public Resource loadFileAsResource(String storedFileName) {
        try {
            if (storedFileName == null || storedFileName.contains("..") || storedFileName.contains("/") || storedFileName.contains("\\")) {
                throw new IllegalArgumentException("Invalid stored file name");
            }
            Path filePath = this.fileStorageLocation.resolve(storedFileName).normalize();
            if (!filePath.startsWith(this.fileStorageLocation)) {
                throw new SecurityException("Cannot access file outside upload directory");
            }
            Resource resource = new UrlResource(filePath.toUri());
            if (resource.exists() && resource.isReadable()) {
                return resource;
            } else {
                throw new RuntimeException("File not found " + storedFileName);
            }
        } catch (MalformedURLException ex) {
            throw new RuntimeException("File not found " + storedFileName, ex);
        }
    }

    public int calculatePageCount(File file, String extension, String originalFileName) {
        if ("pdf".equals(extension)) {
            int pages;
            try (PDDocument doc = Loader.loadPDF(file)) {
                pages = doc.getNumberOfPages();
                if (pages <= 0) {
                    throw new IllegalArgumentException("Invalid PDF document: page count is zero");
                }
            } catch (Exception e) {
                throw new IllegalArgumentException("Invalid or corrupted PDF file: " + originalFileName, e);
            }
            if (pages > MAX_PDF_PAGES) {
                throw new IllegalArgumentException("PDF exceeds the maximum of " + MAX_PDF_PAGES + " pages: " + originalFileName);
            }
            return pages;
        } else if ("docx".equals(extension)) {
            try (FileInputStream fis = new FileInputStream(file);
                 XWPFDocument docx = new XWPFDocument(fis)) {
                int metadataPages = 0;
                POIXMLProperties props = docx.getProperties();
                if (props != null && props.getExtendedProperties() != null) {
                    metadataPages = props.getExtendedProperties().getPages();
                }
                // M-06: metadata Pages is untrusted — cross-check with full-text length
                // and bill the larger of the two so under-counted metadata can't under-charge.
                int textEstimate = estimatePagesFromText(new org.apache.poi.xwpf.extractor.XWPFWordExtractor(docx).getText());
                return Math.max(1, Math.max(metadataPages, textEstimate));
            } catch (Exception e) {
                throw new IllegalArgumentException("Invalid or corrupted DOCX file: " + originalFileName, e);
            }
        } else if ("doc".equals(extension)) {
            try (FileInputStream fis = new FileInputStream(file);
                 HWPFDocument doc = new HWPFDocument(fis)) {
                int metadataPages = 0;
                SummaryInformation summary = doc.getSummaryInformation();
                if (summary != null) {
                    metadataPages = summary.getPageCount();
                }
                int textEstimate = estimatePagesFromText(new org.apache.poi.hwpf.extractor.WordExtractor(doc).getText());
                return Math.max(1, Math.max(metadataPages, textEstimate));
            } catch (Exception e) {
                throw new IllegalArgumentException("Invalid or corrupted DOC file: " + originalFileName, e);
            }
        } else if ("jpg".equals(extension) || "jpeg".equals(extension) || "png".equals(extension)) {
            try {
                BufferedImage image = ImageIO.read(file);
                if (image == null) {
                    throw new IllegalArgumentException("Invalid or unreadable image file: " + originalFileName);
                }
                return 1;
            } catch (IOException e) {
                throw new IllegalArgumentException("Corrupted image file: " + originalFileName, e);
            }
        }

        return 1;
    }

    private int estimatePagesFromText(String text) {
        if (text == null || text.isBlank()) {
            return 1;
        }
        return Math.max(1, (int) Math.ceil((double) text.length() / CHARS_PER_PAGE_ESTIMATE));
    }

    /**
     * Minimal sanitizer for extracted DOCX text/HTML snippets: strips script tags
     * when no HTML-sanitizer dependency is available.
     */
    public static String sanitizeExtractedHtml(String html) {
        if (html == null) {
            return null;
        }
        return html.replaceAll("(?is)<script.*?</script>", "");
    }

    private String getFileExtension(String fileName) {
        if (fileName == null) return "";
        int lastIndex = fileName.lastIndexOf('.');
        return lastIndex == -1 ? "" : fileName.substring(lastIndex + 1);
    }
}
