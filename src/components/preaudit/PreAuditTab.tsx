import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import {
  PILLARS,
  CERTIFICATIONS,
  SCORE_LABELS,
  LEVEL_CONFIG,
  LEVEL_INTERPRETATION,
  PILLAR_RECOMMENDATIONS,
  calculateAuditResult,
  type AuditResult,
  type IndicativeLevel,
} from '@/data/preAuditData';
import {
  ChevronDown,
  ChevronUp,
  Shield,
  Award,
  BarChart3,
  Loader2,
  Save,
  Calculator,
  AlertTriangle,
  CheckCircle,
  Target,
  Info,
  Anchor,
} from 'lucide-react';

export function PreAuditTab() {
  const { user, organization, orgRole } = useAuth();
  const canEdit = orgRole === 'owner' || orgRole === 'collaborator';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, number | undefined>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [selectedCerts, setSelectedCerts] = useState<Record<string, boolean>>({});
  const [expandedPillars, setExpandedPillars] = useState<Record<string, boolean>>({});
  const [showResults, setShowResults] = useState(false);

  // Load existing session
  const loadSession = useCallback(async () => {
    if (!organization?.id) return;
    setLoading(true);
    try {
      // Get the latest session for this org
      const { data: sessions } = await supabase
        .from('pre_audit_sessions')
        .select('*')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (sessions && sessions.length > 0) {
        const session = sessions[0];
        setSessionId(session.id);
        if (session.status === 'completed') setShowResults(true);

        // Load answers
        const { data: answerRows } = await supabase
          .from('pre_audit_answers')
          .select('*')
          .eq('session_id', session.id);

        if (answerRows) {
          const ans: Record<string, number | undefined> = {};
          const coms: Record<string, string> = {};
          answerRows.forEach((r: { pillar_key: string; question_index: number; score: number | null; comment: string | null }) => {
            const key = `${r.pillar_key}_${r.question_index}`;
            if (r.score !== null) ans[key] = r.score;
            if (r.comment) coms[key] = r.comment;
          });
          setAnswers(ans);
          setComments(coms);
        }

        // Load certifications
        const { data: certRows } = await supabase
          .from('pre_audit_certifications')
          .select('*')
          .eq('session_id', session.id);

        if (certRows) {
          const certs: Record<string, boolean> = {};
          certRows.forEach((r: { certification_key: string; is_active: boolean }) => {
            certs[r.certification_key] = r.is_active;
          });
          setSelectedCerts(certs);
        }
      }
    } catch (err) {
      console.error('Failed to load pre-audit session:', err);
    } finally {
      setLoading(false);
    }
  }, [organization?.id]);

  useEffect(() => { loadSession(); }, [loadSession]);

  // Create or get session ID
  const ensureSession = async (): Promise<string | null> => {
    if (sessionId) return sessionId;
    if (!organization?.id || !user?.id) return null;

    const { data, error } = await supabase
      .from('pre_audit_sessions')
      .insert({ organization_id: organization.id, started_by: user.id })
      .select('id')
      .single();

    if (error) {
      toast({ title: 'Error', description: 'Failed to create audit session', variant: 'destructive' });
      return null;
    }
    setSessionId(data.id);
    return data.id;
  };

  // Save progress
  const handleSave = async () => {
    setSaving(true);
    try {
      const sid = await ensureSession();
      if (!sid) return;

      // Upsert all answers
      const answerRows = Object.entries(answers)
        .filter(([, v]) => typeof v === 'number')
        .map(([key, score]) => {
          const parts = key.split('_');
          const questionIndex = parseInt(parts.pop()!, 10);
          const pillarKey = parts.join('_');
          return {
            session_id: sid,
            pillar_key: pillarKey,
            question_index: questionIndex,
            score: score as number,
            comment: comments[key] || null,
          };
        });

      if (answerRows.length > 0) {
        const { error: ansErr } = await supabase
          .from('pre_audit_answers')
          .upsert(answerRows, { onConflict: 'session_id,pillar_key,question_index' });
        if (ansErr) throw ansErr;
      }

      // Upsert certifications
      const certRows = Object.entries(selectedCerts).map(([key, active]) => ({
        session_id: sid,
        certification_key: key,
        is_active: active,
      }));

      // Delete existing and re-insert
      await supabase.from('pre_audit_certifications').delete().eq('session_id', sid);
      if (certRows.length > 0) {
        const { error: certErr } = await supabase
          .from('pre_audit_certifications')
          .insert(certRows);
        if (certErr) throw certErr;
      }

      toast({ title: 'Saved', description: 'Your pre-audit progress has been saved.' });
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Failed to save progress', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Calculate and save results
  const handleCalculate = async () => {
    const result = calculateAuditResult(answers, selectedCerts);
    if (!result.complete) {
      toast({ title: 'Incomplete', description: 'Please answer all 40 questions before calculating results.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const sid = await ensureSession();
      if (!sid) return;

      // Save answers first
      await handleSave();

      // Update session with results
      const { error: sessErr } = await supabase
        .from('pre_audit_sessions')
        .update({
          status: 'completed',
          global_score_raw: result.pillarResults.reduce((sum, p) => sum + (p.rawScore ?? 0), 0) / result.pillarResults.length,
          global_score_adjusted: result.globalAdjusted,
          global_percentage: result.globalPct,
          indicative_level: result.level,
          completed_at: new Date().toISOString(),
        })
        .eq('id', sid);
      if (sessErr) throw sessErr;

      // Save pillar results
      await supabase.from('pre_audit_pillar_results').delete().eq('session_id', sid);
      const pillarRows = result.pillarResults.map((p) => ({
        session_id: sid,
        pillar_key: p.key,
        raw_score: p.rawScore,
        certification_factor: p.factor,
        adjusted_score: p.adjustedScore,
        adjusted_percentage: p.adjustedPct,
      }));
      const { error: pilErr } = await supabase
        .from('pre_audit_pillar_results')
        .insert(pillarRows);
      if (pilErr) throw pilErr;

      setShowResults(true);
      toast({ title: 'Results calculated', description: `Indicative level: ${LEVEL_CONFIG[result.level!].label}` });
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Failed to save results', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const answeredCount = Object.values(answers).filter((v) => typeof v === 'number').length;
  const result = calculateAuditResult(answers, selectedCerts);

  const togglePillar = (key: string) => {
    setExpandedPillars((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const setAnswer = (pillarKey: string, qIndex: number, score: number) => {
    setAnswers((prev) => ({ ...prev, [`${pillarKey}_${qIndex}`]: score }));
  };

  const setComment = (pillarKey: string, qIndex: number, text: string) => {
    setComments((prev) => ({ ...prev, [`${pillarKey}_${qIndex}`]: text }));
  };

  const toggleCert = (certKey: string) => {
    setSelectedCerts((prev) => ({ ...prev, [certKey]: !prev[certKey] }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero / Introduction */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-primary/10 rounded-xl">
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-gray-900 mb-1">S3 Indicative Pre-Audit</h2>
              <p className="text-gray-600 mb-4">
                This self-assessment provides an indicative reading of your marina's maturity level across the 8 pillars of the S3 standard.
                It is designed to reassure, qualify overall readiness and highlight priority areas for improvement.
              </p>
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-2 text-sm bg-white px-3 py-1.5 rounded-full border">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  <span><strong>{answeredCount}</strong>/40 questions answered</span>
                </div>
                <div className="flex items-center gap-2 text-sm bg-white px-3 py-1.5 rounded-full border">
                  <Award className="h-4 w-4 text-primary" />
                  <span><strong>{Object.values(selectedCerts).filter(Boolean).length}</strong> certifications active</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Indicative notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
        <Info className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-amber-800">
          <strong>Indicative use only.</strong> This pre-audit does not constitute a formal S3 certification and does not replace a complete audit,
          documentary review or on-site verification.
        </div>
      </div>

      {/* Score Legend */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Scoring Scale</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
            {Object.entries(SCORE_LABELS).map(([score, label]) => (
              <div key={score} className="text-center p-2 bg-gray-50 rounded-lg border">
                <div className="text-lg font-bold text-primary">{score}</div>
                <div className="text-xs text-gray-600">{label}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Pillars */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Evaluation Pillars</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => {
              const all: Record<string, boolean> = {};
              PILLARS.forEach((p) => { all[p.key] = true; });
              setExpandedPillars(all);
            }}>
              Expand All
            </Button>
            <Button size="sm" variant="outline" onClick={() => setExpandedPillars({})}>
              Collapse All
            </Button>
          </div>
        </div>

        {PILLARS.map((pillar, pIndex) => {
          const isOpen = !!expandedPillars[pillar.key];
          const pillarAnswered = pillar.questions.filter((_, qi) => typeof answers[`${pillar.key}_${qi}`] === 'number').length;
          const pillarResult = result.pillarResults.find((r) => r.key === pillar.key);
          const rawScore = pillarResult?.rawScore;

          return (
            <Card key={pillar.key} className={`overflow-hidden transition-all ${isOpen ? 'ring-1 ring-primary/20' : ''}`}>
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => togglePillar(pillar.key)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                      P{pIndex + 1}
                    </span>
                    <h4 className="font-semibold text-gray-900">{pillar.title}</h4>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">{pillar.subtitle}</p>
                </div>
                <div className="flex items-center gap-3 ml-4">
                  <div className="text-right">
                    <div className="text-sm font-medium">
                      {pillarAnswered}/5
                    </div>
                    {rawScore != null && (
                      <div className="text-xs text-gray-500">{rawScore.toFixed(2)}/5</div>
                    )}
                  </div>
                  <Progress value={(pillarAnswered / 5) * 100} className="w-16 h-2" />
                  {isOpen ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
                </div>
              </div>

              {isOpen && (
                <div className="border-t px-4 pb-4 space-y-4">
                  {pillar.questions.map((question, qIndex) => {
                    const qKey = `${pillar.key}_${qIndex}`;
                    const currentScore = answers[qKey];
                    return (
                      <div key={qKey} className="pt-4 border-t first:border-t-0 first:pt-2">
                        <div className="text-xs text-gray-400 mb-1">Question {qIndex + 1}</div>
                        <p className="text-sm font-medium text-gray-800 mb-3">{question}</p>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {[0, 1, 2, 3, 4, 5].map((score) => (
                            <button
                              key={score}
                              disabled={!canEdit}
                              onClick={() => setAnswer(pillar.key, qIndex, score)}
                              className={`
                                min-w-[44px] h-10 px-3 rounded-lg border font-semibold text-sm transition-all
                                ${currentScore === score
                                  ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/30'
                                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                                }
                                ${!canEdit ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}
                              `}
                            >
                              {score}
                            </button>
                          ))}
                        </div>
                        {canEdit && (
                          <textarea
                            value={comments[qKey] || ''}
                            onChange={(e) => setComment(pillar.key, qIndex, e.target.value)}
                            placeholder="Optional comment, context or evidence..."
                            className="w-full mt-2 min-h-[60px] resize-y rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/30"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Certifications */}
      <div className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold">Existing Certifications</h3>
          <p className="text-sm text-gray-500">Active certifications moderately boost the relevant pillars. Factor capped at 1.20 per pillar.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {CERTIFICATIONS.map((cert) => {
            const isActive = !!selectedCerts[cert.key];
            const impacts = Object.entries(cert.multipliers);
            return (
              <Card key={cert.key} className={`transition-all ${isActive ? 'ring-1 ring-primary/30 bg-primary/5' : ''}`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h5 className="font-semibold text-sm text-gray-900">{cert.label}</h5>
                      <p className="text-xs text-gray-500 mt-0.5">{cert.note}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={() => canEdit && toggleCert(cert.key)}
                        disabled={!canEdit}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                    </label>
                  </div>
                  {impacts.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {impacts.map(([pillarKey, factor]) => {
                        const pillar = PILLARS.find((p) => p.key === pillarKey);
                        return (
                          <span key={pillarKey} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border">
                            {pillar?.title.split(' ')[0]} ×{factor.toFixed(2)}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      {canEdit && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h3 className="font-semibold">Calculate & Save</h3>
                <p className="text-sm text-gray-500">Complete all 40 questions to get your indicative result.</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Save Draft
                </Button>
                <Button onClick={handleCalculate} disabled={saving || answeredCount < 40}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Calculator className="h-4 w-4 mr-2" />}
                  Calculate Result
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {showResults && result.complete && result.level && (
        <div className="space-y-4">
          <Card className={`border-2 ${LEVEL_CONFIG[result.level].borderClass}`}>
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                <div>
                  <div className="text-xs uppercase tracking-widest text-gray-500 mb-2">S3 Indicative Summary</div>
                  <Badge className={`text-base px-4 py-1.5 ${LEVEL_CONFIG[result.level].bgClass} ${LEVEL_CONFIG[result.level].textClass} ${LEVEL_CONFIG[result.level].borderClass} border`}>
                    {LEVEL_CONFIG[result.level].label}
                  </Badge>
                  <h3 className="text-2xl font-bold mt-3 mb-2">{LEVEL_CONFIG[result.level].label} — Indicative Level</h3>
                  <p className="text-gray-600 max-w-xl">{LEVEL_INTERPRETATION[result.level]}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 min-w-[240px]">
                  <div className="bg-gray-50 rounded-xl p-4 text-center border">
                    <div className="text-xs text-gray-500 mb-1">Score /5</div>
                    <div className="text-3xl font-bold text-primary">{result.globalAdjusted!.toFixed(2)}</div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-4 text-center border">
                    <div className="text-xs text-gray-500 mb-1">Score /100</div>
                    <div className="text-3xl font-bold text-primary">{Math.round(result.globalPct!)}%</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pillar breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Per-pillar results */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Pillar Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.pillarResults.map((p) => (
                  <div key={p.key} className="p-3 bg-gray-50 rounded-lg border">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-medium">{p.title}</span>
                      <span className="text-sm font-bold">{p.adjustedScore!.toFixed(2)} / 5</span>
                    </div>
                    <Progress value={p.adjustedPct!} className="h-2 mb-1" />
                    <div className="text-xs text-gray-500">
                      Raw {p.rawScore!.toFixed(2)} · Factor {p.factor.toFixed(2)}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Priorities */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  Priority Improvement Areas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.priorities!.map((p, idx) => (
                  <div key={p.key} className="p-3 bg-gray-50 rounded-lg border">
                    <div className="text-xs text-gray-400 mb-1">Priority {idx + 1} — {p.title}</div>
                    <p className="text-sm text-gray-700">{p.recommendation}</p>
                  </div>
                ))}

                <div className="pt-3 space-y-2">
                  <Button className="w-full" size="sm">
                    <Anchor className="h-4 w-4 mr-2" />
                    Request a full S3 audit
                  </Button>
                  <Button variant="outline" className="w-full" size="sm">
                    Discuss your S3 roadmap with M3
                  </Button>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  This result remains indicative and strategic. It aims to structure the next discussion, not to replace the formal certification process.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Sidebar progress (on mobile, shown as a card at the bottom) */}
      <Card className="bg-gray-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Completion Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-white rounded-xl p-3 text-center border">
              <div className="text-xs text-gray-500 mb-1">Questions</div>
              <div className="text-xl font-bold">{answeredCount}/40</div>
            </div>
            <div className="bg-white rounded-xl p-3 text-center border">
              <div className="text-xs text-gray-500 mb-1">Certifications</div>
              <div className="text-xl font-bold">{Object.values(selectedCerts).filter(Boolean).length}</div>
            </div>
          </div>
          <div className="space-y-2">
            {PILLARS.map((pillar) => {
              const answered = pillar.questions.filter((_, qi) => typeof answers[`${pillar.key}_${qi}`] === 'number').length;
              const pr = result.pillarResults.find((r) => r.key === pillar.key);
              return (
                <div key={pillar.key} className="bg-white rounded-lg p-2.5 border">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium truncate">{pillar.title}</span>
                    <span className="text-gray-500">
                      {pr?.rawScore !== null && pr?.rawScore !== undefined ? `${pr.rawScore.toFixed(2)}/5` : '—'}
                    </span>
                  </div>
                  <Progress value={(answered / 5) * 100} className="h-1.5" />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
