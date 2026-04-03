-- Allow marina users to update their own submissions
CREATE POLICY "Users can update own projects" ON marina_projects
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own rfps" ON rfps
  FOR UPDATE USING (auth.uid() = marina_user_id)
  WITH CHECK (auth.uid() = marina_user_id);

CREATE POLICY "Users can update own consultations" ON consultations
  FOR UPDATE USING (auth.uid() = marina_user_id)
  WITH CHECK (auth.uid() = marina_user_id);
