# M3 Connect - Marina Industry Platform

A B2B community platform for the marina industry, connecting marinas with industry partners.

![M3 Connect](https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800)

## Features

- 🔐 **Authentication** - User registration with role-based access (User, Marina Pending, Marina Verified, Admin)
- 📚 **Resource Library** - Articles, whitepapers, guides, replays, and case studies with access levels
- 📅 **Events & Webinars** - Event calendar with registration and replay access
- 🤝 **Partner Directory** - Showcase industry partners by sector
- 📝 **Partner Lead Funnel** - Lead capture form for partnership inquiries
- ⚓ **Marina Projects** - Verified marinas can submit project needs
- 🔧 **Admin Panel** - Complete back-office for managing users, content, and leads
- 🌍 **Multi-language** - English and French support

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS + shadcn/ui components
- **Backend**: Supabase (Auth, Database, Storage)
- **i18n**: react-i18next
- **Routing**: React Router v6

---

## 🚀 Quick Deploy to Netlify

### Option 1: Direct Deploy (Fastest)

1. **Fork/Upload to GitHub**
   - Create a new GitHub repository
   - Upload this project

2. **Deploy on Netlify**
   - Go to [netlify.com](https://netlify.com) and sign in
   - Click "Add new site" → "Import an existing project"
   - Connect your GitHub repo
   - Build settings (auto-detected):
     - Build command: `npm run build`
     - Publish directory: `dist`
   - Click "Deploy"

3. **Add Environment Variables**
   - In Netlify: Site Settings → Environment Variables
   - Add:
     ```
     VITE_SUPABASE_URL=your-supabase-url
     VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
     ```
   - Redeploy the site

### Option 2: CLI Deploy

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Build the project
npm install
npm run build

# Deploy
netlify deploy --prod --dir=dist
```

---

## 🗄️ Supabase Setup

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the project to be ready (~2 minutes)

### 2. Run Database Schema

1. Go to **SQL Editor** in your Supabase dashboard
2. Copy the entire contents of `supabase-schema.sql`
3. Paste and run the query
4. This creates all tables, RLS policies, and seed data

### 3. Get API Keys

1. Go to **Settings** → **API**
2. Copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon/public key** → `VITE_SUPABASE_ANON_KEY`

### 4. Configure Auth (Optional)

1. Go to **Authentication** → **Providers**
2. Email is enabled by default
3. Optional: Enable Google, GitHub, etc.

### 5. Create Admin User

1. Register a new user on your deployed site
2. Go to Supabase → **Table Editor** → **profiles**
3. Find your user and change `role` to `admin`
4. Now you can access `/admin`

---

## 🛠️ Local Development

```bash
# Clone the repo
git clone <your-repo-url>
cd m3-connect

# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your Supabase credentials

# Start dev server
npm run dev

# Open http://localhost:5173
```

---

## 📁 Project Structure

```
m3-connect/
├── public/
├── src/
│   ├── components/
│   │   ├── auth/         # Login, Signup forms
│   │   ├── layout/       # Navbar, Footer
│   │   └── ui/           # shadcn/ui components
│   ├── contexts/         # AuthContext
│   ├── hooks/            # useToast
│   ├── i18n/             # Translations (EN/FR)
│   ├── lib/              # Utils, Supabase client
│   ├── pages/            # All page components
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── supabase-schema.sql   # Database schema
├── netlify.toml          # Netlify config
├── package.json
└── README.md
```

---

## 📊 User Roles

| Role | Access |
|------|--------|
| `user` | Public + Members resources/events |
| `marina_pending` | Same as user, awaiting verification |
| `marina_verified` | All resources + Submit projects |
| `admin` | Full access + Admin panel |

---

## 🔒 Access Levels

- **Public** 🌍 - Anyone can access
- **Members** 👤 - Logged-in users only
- **Marina** ⚓ - Verified marinas only

---

## 🌐 Routes

| Path | Description |
|------|-------------|
| `/` | Homepage |
| `/resources` | Resource library |
| `/events` | Events calendar |
| `/partners` | Partner directory |
| `/become-partner` | Lead capture form |
| `/account` | User profile & registrations |
| `/submit-project` | Marina project form |
| `/admin/*` | Admin panel (admin only) |

---

## 📝 Customization

### Colors (tailwind.config.js)
```js
primary: "#1e3a5f",    // Deep blue
secondary: "#0d9488",  // Teal
```

### Translations (src/i18n/index.ts)
Add or modify translations in the `resources` object.

### Mock Data
Currently using mock data in pages. Replace with Supabase queries when connected.

---

## 🐛 Troubleshooting

### "Supabase not connected"
- Ensure environment variables are set correctly
- Redeploy after adding env vars on Netlify

### "Page not found on refresh"
- The `netlify.toml` includes redirect rules for SPA
- If still issues, add `_redirects` file: `/* /index.html 200`

### "Admin panel empty"
- Create an admin user (see Supabase Setup step 5)
- Clear browser cache and re-login

---

## 📄 License

MIT License - Feel free to use for your projects.

---

## 🤝 Support

Built for M3 Connect / Monaco Smart & Sustainable Marina Rendezvous.

For questions: [your-email@example.com]
