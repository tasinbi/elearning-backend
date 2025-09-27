// utils/bunnynet.js
const axios = require('axios');

const bunnyConfig = {
    libraryId: process.env.BUNNY_LIBRARY_ID,
    apiKey: process.env.BUNNY_API_KEY,
    pullZone: process.env.BUNNY_PULL_ZONE
};

// Upload video to Bunny.net
const uploadToBunny = async (videoBuffer, fileName) => {
    const response = await axios.put(
        `https://video.bunnycdn.com/library/${bunnyConfig.libraryId}/videos/${fileName}`,
        videoBuffer,
        {
            headers: {
                'AccessKey': bunnyConfig.apiKey,
                'Content-Type': 'application/octet-stream'
            }
        }
    );
    return response.data;
};