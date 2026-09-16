-- Maxieye 数据协作平台 —— 首次部署建库脚本
-- 在服务器上执行（需要 MySQL root）：
--   mysql -uroot -p < deploy/init-db.sql
--
-- 说明：
--   1) 表结构不用手工建。服务启动时会自动 CREATE TABLE IF NOT EXISTS
--      （app_state / bills_finance / bill_items_finance），并自动补齐后加的列。
--   2) 本脚本只做两件事：建库 + 建专用账号授权。
--   3) 账号与供应商名册由 scripts/seed-db.mjs 导入（部署脚本会自动执行）。

CREATE DATABASE IF NOT EXISTS data_label
  CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

-- 专用账号：密码由部署脚本生成并同步写入 .env，不要用 root 跑应用
CREATE USER IF NOT EXISTS 'data_label'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON data_label.* TO 'data_label'@'127.0.0.1';
FLUSH PRIVILEGES;

-- 验收：应看到 utf8mb4
-- SHOW CREATE DATABASE data_label;
