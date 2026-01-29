-- M3 Connect Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  job_title TEXT,
  organization_type TEXT NOT NULL,
  organization_name TEXT NOT NULL,
  country TEXT NOT NULL,
  website TEXT,
  capacity TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'marina_pending', 'marina_verified', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Resources table
CREATE TABLE resources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT,
  type TEXT NOT NULL CHECK (type IN ('article', 'whitepaper', 'guide', 'replay', 'case_study')),
  topic TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'EN',
  access_level TEXT NOT NULL DEFAULT 'public' CHECK (access_level IN ('public', 'members', 'marina')),
  thumbnail_url TEXT,
  file_url TEXT,
  partner_id UUID REFERENCES partners(id),
  published BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Events table
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  date_time TIMESTAMPTZ NOT NULL,
  location TEXT,
  language TEXT NOT NULL DEFAULT 'EN',
  access_level TEXT NOT NULL DEFAULT 'public' CHECK (access_level IN ('public', 'members', 'marina')),
  speakers JSONB,
  partner_id UUID REFERENCES partners(id),
  replay_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event registrations table
CREATE TABLE event_registrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, user_id)
);

-- Partners table
CREATE TABLE partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  logo_url TEXT,
  website TEXT,
  sector TEXT NOT NULL,
  country TEXT NOT NULL,
  is_featured BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Marina projects table
CREATE TABLE marina_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  project_type TEXT NOT NULL,
  budget_range TEXT NOT NULL,
  timeline TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'completed')),
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Partner leads table
CREATE TABLE partner_leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT NOT NULL,
  website TEXT,
  country TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  solutions TEXT,
  goals TEXT,
  engagement_level TEXT NOT NULL,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'qualified', 'in_discussion', 'signed', 'rejected')),
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security (RLS) policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE marina_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_leads ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update their own profile
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all profiles" ON profiles FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'admin')
);

-- Resources: public can view published public resources
CREATE POLICY "Anyone can view public resources" ON resources FOR SELECT USING (published = true AND access_level = 'public');
CREATE POLICY "Members can view member resources" ON resources FOR SELECT USING (published = true AND access_level IN ('public', 'members') AND auth.uid() IS NOT NULL);
CREATE POLICY "Marinas can view marina resources" ON resources FOR SELECT USING (
  published = true AND 
  EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role IN ('marina_verified', 'admin'))
);

-- Events: similar to resources
CREATE POLICY "Anyone can view public events" ON events FOR SELECT USING (access_level = 'public');
CREATE POLICY "Members can view member events" ON events FOR SELECT USING (access_level IN ('public', 'members') AND auth.uid() IS NOT NULL);

-- Event registrations: users can manage their own
CREATE POLICY "Users can view own registrations" ON event_registrations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own registrations" ON event_registrations FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Partners: public can view
CREATE POLICY "Anyone can view partners" ON partners FOR SELECT USING (true);

-- Marina projects: users can manage their own
CREATE POLICY "Users can view own projects" ON marina_projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own projects" ON marina_projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all projects" ON marina_projects FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'admin')
);

-- Partner leads: anyone can insert, admins can view
CREATE POLICY "Anyone can submit lead" ON partner_leads FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can view leads" ON partner_leads FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'admin')
);

-- Seed data
INSERT INTO partners (name, description, sector, country, is_featured) VALUES
('Marina Tech Solutions', 'Leading provider of marina management software and digital solutions.', 'digital', 'France', true),
('EcoPorts International', 'Specialists in environmental solutions for ports and marinas.', 'environment', 'Netherlands', true),
('GreenShore Energy', 'Renewable energy solutions designed for coastal installations.', 'energy', 'Germany', true),
('AquaSmart Systems', 'Smart water management and monitoring systems for marinas.', 'equipment', 'Italy', false),
('PortConnect Services', 'Professional services for marina development and operations consulting.', 'services', 'Monaco', true),
('Blue Marina Consulting', 'Strategic consulting for marina investments and development projects.', 'services', 'Spain', false),
('SmartDock Equipment', 'High-quality marina equipment including floating docks and mooring systems.', 'equipment', 'Croatia', false),
('Mediterranean Marina Institute', 'Research institution dedicated to advancing marina management knowledge.', 'institution', 'Greece', true);

INSERT INTO resources (title, summary, type, topic, language, access_level, thumbnail_url) VALUES
('Sustainable Marina Operations Guide', 'Best practices for implementing sustainable operations in modern marinas.', 'guide', 'Sustainability', 'EN', 'public', 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=400'),
('Digital Transformation in Ports', 'How technology is reshaping the marina industry.', 'whitepaper', 'Technology', 'EN', 'members', 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400'),
('Smart Marina 2024 Highlights', 'Key takeaways from our annual conference.', 'replay', 'Events', 'EN', 'marina', 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=400'),
('Guide des Marinas Durables', 'Meilleures pratiques pour une gestion durable des ports de plaisance.', 'guide', 'Sustainability', 'FR', 'public', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400'),
('Energy Efficiency Case Study: Port Monaco', 'How Port Monaco reduced energy consumption by 40%.', 'case_study', 'Energy', 'EN', 'members', 'https://images.unsplash.com/photo-1569263979104-865ab7cd8d13?w=400'),
('Marina Management Best Practices', 'Comprehensive article on modern marina management techniques.', 'article', 'Management', 'EN', 'public', 'https://images.unsplash.com/photo-1540946485063-a40da27545f8?w=400');

INSERT INTO events (title, description, date_time, location, language, access_level, speakers) VALUES
('Webinar: Energy Efficiency Solutions for Marinas', 'Learn about the latest energy-saving technologies for modern marinas.', '2025-02-15 14:00:00+00', NULL, 'EN', 'public', '[{"name": "Dr. Maria Santos", "title": "Energy Consultant"}]'),
('Marina Managers Roundtable', 'Exclusive session for marina managers to discuss challenges and best practices.', '2025-02-22 10:00:00+00', 'Monaco Yacht Club', 'EN', 'marina', '[{"name": "Pierre Martin", "title": "YCM Director"}]'),
('Partner Showcase: Digital Tools', 'Discover the latest digital solutions from our technology partners.', '2025-03-01 15:00:00+00', NULL, 'EN', 'members', '[{"name": "Tech Partners Panel", "title": ""}]'),
('Smart Marina 2024 Conference - Day 1', 'Full recording of day 1 of our flagship conference.', '2024-09-15 09:00:00+00', 'Monaco', 'EN', 'public', '[{"name": "Multiple Speakers", "title": ""}]'),
('Sustainable Marina Workshop', 'Interactive workshop on implementing sustainable practices.', '2024-11-20 14:00:00+00', NULL, 'FR', 'members', '[{"name": "Sophie Blanc", "title": "Sustainability Expert"}]');

-- Update events with replay URLs for past events
UPDATE events SET replay_url = 'https://example.com/replay' WHERE date_time < NOW();
