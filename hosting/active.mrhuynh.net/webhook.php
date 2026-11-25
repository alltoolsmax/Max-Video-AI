<?php
declare(strict_types=1);
// Webhook SePay CHUNG cho Voice AI + Video AI + Max AI (1 tài khoản ngân hàng, 1 webhook).
//  - Mã đơn thuộc Video AI  → xử lý ở đây (tạo key Video AI).
//  - Mọi trường hợp khác    → chuyển NGUYÊN VẸN sang voice_studio_webhook.php của Voice AI (không sửa file đó).
// Khai báo trên SePay: https://active.mrhuynh.net/webhook.php · Chứng thực API Key (giống Voice AI).
$videoLib = (getenv('VIDEOAI_PRIVATE') ?: __DIR__ . '/../active_private/video') . '/lib.php';

// Max AI (thêm mới): mã đơn của Max AI → tạo key Max AI. Đơn của Video AI / Voice AI đi tiếp như cũ.
$maxLib = (getenv('MAXAI_PRIVATE') ?: __DIR__ . '/../active_private/maxai') . '/lib.php';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && is_file($maxLib)) {
    require_once $maxLib;
    try {
        $d = json_decode((string)file_get_contents('php://input'), true);
        if (is_array($d) && \MaxAI\order_exists(\MaxAI\code_from($d))) {
            if (!\MaxAI\sepay_authorized(\MaxAI\request_auth_header())) {
                \MaxAI\log_line('Webhook chung: sai API Key');
                \MaxAI\json_out(['success' => false, 'error' => 'unauthorized'], 401);
            }
            $r = \MaxAI\handle_payment($d);
            \MaxAI\json_out(['success' => true, 'product' => 'maxai', 'result' => $r]);
        }
    } catch (Throwable $e) {
        \MaxAI\log_line('Webhook chung LỖI: ' . $e->getMessage());
        \MaxAI\json_out(['success' => false, 'error' => 'server error'], 500);   // SePay tự gửi lại
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && is_file($videoLib)) {
    require_once $videoLib;
    try {
        $d = json_decode((string)file_get_contents('php://input'), true);
        if (is_array($d) && \VideoAI\order_exists(\VideoAI\code_from($d))) {
            if (!\VideoAI\sepay_authorized(\VideoAI\request_auth_header())) {
                \VideoAI\log_line('Webhook chung: sai API Key');
                \VideoAI\json_out(['success' => false, 'error' => 'unauthorized'], 401);
            }
            $r = \VideoAI\handle_payment($d);
            \VideoAI\json_out(['success' => true, 'product' => 'videoai', 'result' => $r]);
        }
    } catch (Throwable $e) {
        \VideoAI\log_line('Webhook chung LỖI: ' . $e->getMessage());
        \VideoAI\json_out(['success' => false, 'error' => 'server error'], 500);   // SePay tự gửi lại
    }
}
require __DIR__ . '/voice_studio_webhook.php';
