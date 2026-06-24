import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '3SChat', short_name: '3SChat', description: 'Secure real-time messaging',
    start_url: '/chat', display: 'standalone', background_color: '#0d0e12', theme_color: '#111614',
    icons: [{ src: '/favicon.ico', sizes: 'any', type: 'image/x-icon' }],
  };
}
