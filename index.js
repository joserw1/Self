const { Client } = require('discord.js-selfbot-v13');
const { joinVoiceChannel, entersState, VoiceConnectionStatus, getVoiceConnection } = require('@discordjs/voice');
const fs = require('fs');

// Load konfigurasi akun
let accounts = [];
try {
    if (fs.existsSync('./accounts.json')) {
        const data = fs.readFileSync('./accounts.json', 'utf8');
        accounts = JSON.parse(data).accounts;
        console.log(`✅ Loaded ${accounts.length} accounts from accounts.json`);
    } 
    else if (process.env.ACCOUNTS_JSON) {
        accounts = JSON.parse(process.env.ACCOUNTS_JSON).accounts;
        console.log(`✅ Loaded ${accounts.length} accounts from ENV`);
    }
    else {
        console.error('❌ No accounts configuration found!');
        process.exit(1);
    }
} catch (error) {
    console.error('❌ Error loading accounts:', error.message);
    process.exit(1);
}

// Konfigurasi global
const CHECK_INTERVAL = 60;
const MAX_RECONNECT_ATTEMPTS = 10;

// Simpan semua koneksi aktif
const activeConnections = new Map();

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runAccount(accountConfig, index) {
    const client = new Client();
    const accountName = accountConfig.name || `Akun ${index + 1}`;
    let connection = null;
    let isConnected = false;
    let reconnectAttempts = 0;

    client.on('ready', async () => {
        console.log(`=================================`);
        console.log(`✅ [${accountName}] AKTIF: ${client.user.tag}`);
        console.log(`🆔 User ID: ${client.user.id}`);
        console.log(`📡 Target Guild ID: ${accountConfig.guildId}`);
        console.log(`📡 Target Voice ID: ${accountConfig.voiceChannelId}`);
        console.log(`=================================`);

        client.user.setStatus('online');
        await joinVoiceForAccount(client, accountConfig, accountName);

        activeConnections.set(accountConfig.token, {
            client,
            accountName,
            isConnected: () => isConnected
        });
    });

    async function joinVoiceForAccount(client, config, name) {
        try {
            const guild = client.guilds.cache.get(config.guildId);
            if (!guild) {
                console.error(`❌ [${name}] Guild ${config.guildId} tidak ditemukan!`);
                return false;
            }

            const voiceChannel = guild.channels.cache.get(config.voiceChannelId);
            if (!voiceChannel) {
                console.error(`❌ [${name}] Voice channel ${config.voiceChannelId} tidak ditemukan!`);
                return false;
            }

            console.log(`📡 [${name}] Menghubungkan ke ${voiceChannel.name}...`);

            const existingConnection = getVoiceConnection(config.guildId);
            if (existingConnection) {
                existingConnection.destroy();
                await sleep(2000);
            }

            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: true,
                selfMute: true
            });

            await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
            isConnected = true;
            reconnectAttempts = 0;

            console.log(`✅ [${name}] BERHASIL connect ke ${voiceChannel.name}`);

            client.user.setPresence({
                status: 'online',
                activities: [{
                    name: `AFK 24/7: ${voiceChannel.name}`,
                    type: 'CUSTOM'
                }]
            });

            connection.on('stateChange', (oldState, newState) => {
                if (newState.status === VoiceConnectionStatus.Disconnected) {
                    console.log(`⚠️ [${name}] Terputus dari voice channel`);
                    isConnected = false;
                    handleReconnect();
                }
            });

            return true;

        } catch (error) {
            console.error(`❌ [${name}] Error:`, error.message);
            isConnected = false;
            handleReconnect();
            return false;
        }

        function handleReconnect() {
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                console.error(`❌ [${name}] Gagal reconnect, stop mencoba`);
                return;
            }

            reconnectAttempts++;
            const delay = Math.min(5000 * reconnectAttempts, 60000);

            console.log(`🔄 [${name}] Reconnect dalam ${delay/1000}dtk (percobaan ${reconnectAttempts})`);

            setTimeout(() => {
                joinVoiceForAccount(client, config, name);
            }, delay);
        }
    }

    client.on('voiceStateUpdate', (oldState, newState) => {
        if (newState.member.id === client.user.id) {
            if (!newState.channelId && oldState.channelId) {
                console.log(`👋 [${accountName}] Keluar dari voice`);
                isConnected = false;
                setTimeout(() => joinVoiceForAccount(client, accountConfig, accountName), 5000);
            }
            
            if (newState.channelId && newState.channelId !== accountConfig.voiceChannelId && oldState.channelId === accountConfig.voiceChannelId) {
                console.log(`⚠️ [${accountName}] Dipindahkan paksa! Kembalikan...`);
                setTimeout(() => joinVoiceForAccount(client, accountConfig, accountName), 3000);
            }
        }
    });

    client.on('error', (error) => {
        console.error(`❌ [${accountName}] Error:`, error.message);
    });

    client.on('disconnect', () => {
        console.log(`🔴 [${accountName}] Disconnected`);
        isConnected = false;
        setTimeout(() => {
            client.login(accountConfig.token);
        }, 10000);
    });

    try {
        await client.login(accountConfig.token);
    } catch (error) {
        console.error(`❌ [${accountName}] Gagal login:`, error.message);
    }
}

// Status checker
setInterval(() => {
    console.log(`\n📊 [${new Date().toLocaleString('id-ID')}] Status Koneksi:`);
    activeConnections.forEach((value, key) => {
        console.log(`   - ${value.accountName}: ${value.isConnected() ? '✅ Connected' : '❌ Disconnected'}`);
    });
}, CHECK_INTERVAL * 1000);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log(`\n👋 Mematikan semua akun...`);
    activeConnections.forEach((value) => {
        value.client.destroy();
    });
    process.exit(0);
});

// Jalankan semua akun
console.log(`=================================`);
console.log(`🎧 MULTI-AKUN DISCORD AFK 24/7`);
console.log(`=================================`);
console.log(`Memulai ${accounts.length} akun...\n`);

accounts.forEach((account, index) => {
    setTimeout(() => {
        runAccount(account, index);
    }, index * 5000);
});
