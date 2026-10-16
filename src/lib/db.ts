// src/lib/db.ts
import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  // If the .env property evaluates to undefined, it automatically drops back to standard XAMPP values
  host: import.meta.env.MYSQL_HOST || '127.0.0.1',
  user: import.meta.env.MYSQL_USER || 'root',
  password: import.meta.env.MYSQL_PASSWORD || '', // Default XAMPP password is blank
  database: import.meta.env.MYSQL_DATABASE || 'my_app_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});