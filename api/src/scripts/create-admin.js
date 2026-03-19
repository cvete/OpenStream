#!/usr/bin/env node

/**
 * Create Admin User CLI Script
 * Usage: node src/scripts/create-admin.js --username <user> --email <email> --password <pass>
 */

const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const args = process.argv.slice(2);

function getArg(name) {
    const index = args.indexOf(`--${name}`);
    if (index === -1 || index + 1 >= args.length) return null;
    return args[index + 1];
}

async function createAdmin() {
    const username = getArg('username');
    const email = getArg('email');
    const password = getArg('password');

    if (!username || !email || !password) {
        console.error('Usage: node src/scripts/create-admin.js --username <user> --email <email> --password <pass>');
        process.exit(1);
    }

    // Validate password strength
    if (password.length < 12) {
        console.error('Error: Password must be at least 12 characters.');
        process.exit(1);
    }

    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        console.error('Error: Password must contain uppercase, lowercase, and numeric characters.');
        process.exit(1);
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        console.error('Error: Invalid email format.');
        process.exit(1);
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error('Error: DATABASE_URL environment variable is required.');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: databaseUrl });

    try {
        // Check if username or email already exists
        const existing = await pool.query(
            'SELECT username, email FROM users WHERE username = $1 OR email = $2',
            [username, email]
        );

        if (existing.rows.length > 0) {
            const match = existing.rows[0];
            if (match.username === username) {
                console.error(`Error: Username "${username}" already exists.`);
            } else {
                console.error(`Error: Email "${email}" already exists.`);
            }
            process.exit(1);
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const role = 'admin';
        await pool.query(
            'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)',
            [username, email, passwordHash, role]
        );

        console.log(`Admin user "${username}" created successfully.`);
    } catch (error) {
        console.error('Error creating admin user:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

createAdmin();
