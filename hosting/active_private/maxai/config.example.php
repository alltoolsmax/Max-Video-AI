<?php
// Max AI - Mr. Huỳnh · cấu hình máy chủ bản quyền (dùng chung hosting với Video AI / Voice AI).
// tools/prepare-hosting.js tự tạo config.php từ file này (điền sẵn seed_hex). KHÔNG đặt trong thư mục công khai.
return [
    // "Con dấu" ký giấy phép Max AI: 64 ký tự hex (KHÁC Video AI / Voice AI). Không gửi cho ai, nhớ sao lưu.
    'seed_hex' => 'DAN_SEED_HEX_VAO_DAY',

    // Mật khẩu trang quản trị: dùng chung admin_password của Video AI (active_private/video/config.php).

    // Để trống = dùng chung của Voice AI (active_private/config.php): sepay_api_key, bank, telegram, code_prefix
    'sepay_api_key'    => '',
    'telegram_token'   => '',
    'telegram_chat_id' => '',
    'bank'             => null,

    // Bảng giá mặc định gói Chuyên nghiệp – lấy theo Video AI (sửa tiếp trong trang quản trị › Max AI › Bảng giá)
    'plans' => [
        'm1' => ['name' => '1 tháng', 'days' => 30,  'price' => 80000,  'badge' => null],
        'm3' => ['name' => '3 tháng', 'days' => 90,  'price' => 220000, 'badge' => 'Phổ biến'],
        'm6' => ['name' => '6 tháng', 'days' => 180, 'price' => 450000, 'badge' => 'Tiết kiệm 30.000đ'],
        'y1' => ['name' => '1 năm',   'days' => 365, 'price' => 900000, 'badge' => 'Tiết kiệm 60.000đ'],
    ],

    'contact_zalo'  => 'https://zalo.me/0979007367',
    'contact_phone' => '0979007367',
    'contact_name'  => 'Mr. Huỳnh',

    'github_repo'            => 'alltoolsmax/Max-Video-AI',   // GitHub build bộ cài Windows + macOS
    'order_ttl_minutes'      => 30,
    'transfer_cooldown_days' => 30,   // khách tự chuyển key sang máy mới: 1 lần / N ngày
    'recheck_hours'          => 24,   // phần mềm kiểm tra lại bản quyền sau
    'offline_grace_days'     => 3,    // dùng không mạng tối đa
    'timezone'               => 'Asia/Ho_Chi_Minh',
];
