import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert } from "react-native";
import { useEffect, useState, useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/features/auth/AuthContext";
import { colors } from "../../src/ui/colors";
import { database } from "../../src/db/database";
import DaySession from "../../src/db/models/DaySession";
import ClockEvent from "../../src/db/models/ClockEvent";
import { SyncEngine } from "../../src/features/tickets/sync/SyncEngine";
import { createClockEvent } from "../../src/features/tickets/domain/outbox";
import {
  checkActiveTickets,
  closeActiveSession,
  getActiveTicketsErrorMessage,
} from "../../src/features/timesheet/utils/validation";
import { checkUserBreakStatus, getTodayDateString } from "../../src/features/timesheet/utils/breakStatus";
import { TicketSelectorModal } from "../../src/features/timesheet/components/TicketSelectorModal";
import type { BreakType, ClockEventType } from "../../src/features/timesheet/types";
import { Q } from "@nozbe/watermelondb";

export default function Timesheet() {
  const { user } = useAuth();
  const [session, setSession] = useState<DaySession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [breakStartedAt, setBreakStartedAt] = useState<number | null>(null);
  const [currentBreakType, setCurrentBreakType] = useState<BreakType | null>(null);
  const [showTicketSelector, setShowTicketSelector] = useState(false);

  const loadTodaySession = useCallback(async () => {
    if (!user) return;
    
    try {
      setIsLoading(true);
      const today = getTodayDateString();
      
      const sessionsCollection = database.collections.get<DaySession>('day_sessions');
      const sessions = await sessionsCollection
        .query(
          Q.where('user_id', user.id),
          Q.where('date', today),
          Q.sortBy('created_at', Q.desc)  // Get latest session first
        )
        .fetch();
      
      if (sessions.length > 0) {
        setSession(sessions[0]);  // Now this is the LATEST session

        const breakStatus = await checkUserBreakStatus(user.id, today);
        setCurrentBreakType(breakStatus.isOnBreak ? breakStatus.breakType : null);
        setBreakStartedAt(breakStatus.isOnBreak ? breakStatus.startedAt : null);
      } else {
        setSession(null);
        setCurrentBreakType(null);
        setBreakStartedAt(null);
      }
    } catch (error) {
      console.error('[Timesheet] Failed to load session:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadTodaySession();
  }, [loadTodaySession]);

  const handleClockIn = async () => {
    if (!user) return;
    
    try {
      setIsProcessing(true);
      const now = Date.now();
      const today = new Date().toISOString().split('T')[0];
      
      let newSessionId = '';
      const orphanCloseOuts: Array<{
        sessionId: string;
        clockInAt: number;
        clockOutAt: number;
        date: string;
      }> = [];

      await database.write(async () => {
        const sessionsCollection = database.collections.get<DaySession>('day_sessions');
        const eventsCollection = database.collections.get<ClockEvent>('clock_events');
        
        // Auto-close any orphaned ACTIVE sessions before creating new one
        const orphaned = await sessionsCollection
          .query(
            Q.where('user_id', user.id),
            Q.where('status', 'ACTIVE')
          )
          .fetch();
        if (orphaned.length > 0) {
          console.log(`[Timesheet] Auto-closing ${orphaned.length} orphaned ACTIVE sessions`);
          for (const old of orphaned) {
            const closedAt = old.clockInAt + 1000; // 1 second after clock in
            orphanCloseOuts.push({
              sessionId: old.id,
              clockInAt: old.clockInAt,
              clockOutAt: closedAt,
              date: old.date,
            });
            await old.update(s => {
              s.status = 'CLOCKED_OUT';
              s.clockOutAt = closedAt;
            });
            // Mirror the close on the server by writing a local CLOCK_OUT
            // ClockEvent; the outbox CLOCK_EVENT queued below syncs it.
            await eventsCollection.create((e) => {
              e.sessionId = old.id;
              e.userId = user.id;
              e.eventType = 'CLOCK_OUT';
              e.occurredAt = closedAt;
              e.reason = 'AUTO_CLOSE_ORPHAN';
            });
          }
        }
        
        // Create new day session
        const newSession = await sessionsCollection.create((s) => {
          s.userId = user.id;
          s.date = today;
          s.clockInAt = now;
          s.status = 'ACTIVE';
        });
        
        newSessionId = newSession.id;
        
        // Create clock in event
        await eventsCollection.create((e) => {
          e.sessionId = newSession.id;
          e.userId = user.id;
          e.eventType = 'CLOCK_IN';
          e.occurredAt = now;
        });
        
        setSession(newSession);
      });
      
      console.log('[Timesheet] Clocked in successfully');

      // Queue a CLOCK_OUT for every orphaned session first so the backend
      // doesn't keep them marked ACTIVE forever (what Ops was showing).
      for (const orphan of orphanCloseOuts) {
        const orphanEvent = createClockEvent({
          sessionId: orphan.sessionId,
          userId: user.id,
          eventType: 'CLOCK_OUT',
          occurredAt: orphan.clockOutAt,
          date: orphan.date,
          clockInAt: orphan.clockInAt,
          clockOutAt: orphan.clockOutAt,
          status: 'CLOCKED_OUT',
          reason: 'AUTO_CLOSE_ORPHAN',
        });
        await SyncEngine.queueEvent(orphanEvent);
      }
      if (orphanCloseOuts.length > 0) {
        console.log(
          `[Timesheet] Queued ${orphanCloseOuts.length} orphan CLOCK_OUT events for backend sync`,
        );
      }

      // Queue clock in event to sync with backend
      const clockEvent = createClockEvent({
        sessionId: newSessionId,
        userId: user.id,
        eventType: 'CLOCK_IN',
        occurredAt: now,
        date: today,
        clockInAt: now,
        status: 'ACTIVE',
      });
      await SyncEngine.queueEvent(clockEvent);
      console.log('[Timesheet] Clock in event queued for sync');
      
      // Pull fresh tickets from server
      console.log('[Timesheet] Pulling fresh tickets after clock in...');
      SyncEngine.pullTickets(true);
    } catch (error) {
      console.error('[Timesheet] Clock in failed:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClockOut = async () => {
    if (!user || !session) return;
    
    try {
      setIsProcessing(true);
      
      // Check for active tickets using shared utility
      const activeCheck = await checkActiveTickets(user.id);
      if (activeCheck.hasActiveTickets) {
        setIsProcessing(false);
        const errorMsg = getActiveTicketsErrorMessage(activeCheck.count, 'clock out');
        Alert.alert(errorMsg.title, errorMsg.message, [{ text: 'OK' }]);
        return;
      }
      
      setIsProcessing(false);
      // Show ticket selector modal - actual clock out happens in handleTicketSelected
      setShowTicketSelector(true);
    } catch (error) {
      console.error('[Timesheet] Clock out validation failed:', error);
      setIsProcessing(false);
    }
  };

  const handleTicketSelected = async (ticketId: string | null) => {
    if (!user || !session) return;
    
    setShowTicketSelector(false);
    setIsProcessing(true);
    
    try {
      await closeActiveSession({
        userId: user.id,
        ticketId: ticketId || undefined,
        endActiveBreak: false,
        requireNoActiveTickets: true,
      });
      await loadTodaySession();
      console.log('[Timesheet] Clocked out successfully', ticketId ? `with ticket ${ticketId}` : 'without ticket');
    } catch (error) {
      console.error('[Timesheet] Clock out failed:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTicketSelectorCancel = () => {
    setShowTicketSelector(false);
    // User cancelled - complete clock out without ticket selection
    handleTicketSelected(null);
  };

  const handleStartBreak = async (breakType: BreakType) => {
    if (!user || !session) return;
    
    try {
      setIsProcessing(true);
      
      // Check for active tickets using shared utility
      const activeCheck = await checkActiveTickets(user.id);
      if (activeCheck.hasActiveTickets) {
        setIsProcessing(false);
        const errorMsg = getActiveTicketsErrorMessage(
          activeCheck.count,
          breakType === 'lunch' ? 'start lunch' : 'start personal time',
        );
        Alert.alert(errorMsg.title, errorMsg.message, [{ text: 'OK' }]);
        return;
      }
      
      const now = Date.now();
      const startEventType: ClockEventType =
        breakType === 'lunch' ? 'LUNCH_START' : 'PERSONAL_START';
      
      await database.write(async () => {
        const eventsCollection = database.collections.get<ClockEvent>('clock_events');
        
        await eventsCollection.create((e) => {
          e.sessionId = session.id;
          e.userId = user.id;
          e.eventType = startEventType;
          e.occurredAt = now;
          if (breakType === 'personal') {
            e.reason = 'PERSONAL_TIME';
          }
        });
      });
      
      setCurrentBreakType(breakType);
      setBreakStartedAt(now);
      console.log(`[Timesheet] ${breakType} started`);
      
      // Queue break start event to backend
      const clockEvent = createClockEvent({
        sessionId: session.id,
        userId: user.id,
        eventType: startEventType,
        occurredAt: now,
        date: session.date,
        clockInAt: session.clockInAt,
        reason: breakType === 'personal' ? 'PERSONAL_TIME' : undefined,
      });
      await SyncEngine.queueEvent(clockEvent);
    } catch (error) {
      console.error(`[Timesheet] Start ${breakType} failed:`, error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEndBreak = async () => {
    if (!user || !session) return;
    if (!currentBreakType) return;
    
    try {
      setIsProcessing(true);
      const now = Date.now();
      const endEventType: ClockEventType =
        currentBreakType === 'lunch' ? 'LUNCH_END' : 'PERSONAL_END';
      
      await database.write(async () => {
        const eventsCollection = database.collections.get<ClockEvent>('clock_events');
        
        await eventsCollection.create((e) => {
          e.sessionId = session.id;
          e.userId = user.id;
          e.eventType = endEventType;
          e.occurredAt = now;
          if (currentBreakType === 'personal') {
            e.reason = 'PERSONAL_TIME';
          }
        });
      });
      
      setCurrentBreakType(null);
      setBreakStartedAt(null);
      console.log('[Timesheet] Break ended');
      
      // Queue break end event to backend
      const clockEvent = createClockEvent({
        sessionId: session.id,
        userId: user.id,
        eventType: endEventType,
        occurredAt: now,
        date: session.date,
        clockInAt: session.clockInAt,
        reason: currentBreakType === 'personal' ? 'PERSONAL_TIME' : undefined,
      });
      await SyncEngine.queueEvent(clockEvent);
    } catch (error) {
      console.error('[Timesheet] End break failed:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const calculateDuration = (start: number, end?: number) => {
    const endTime = end || Date.now();
    const minutes = Math.floor((endTime - start) / 60000);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const isClockedIn = session && session.status === 'ACTIVE';
  const isClockedOut = session && session.status === 'CLOCKED_OUT';
  const isOnBreak = currentBreakType !== null;
  const isOnLunch = currentBreakType === 'lunch';
  const isOnPersonal = currentBreakType === 'personal';

  return (
    <View className="flex-1" style={{ backgroundColor: colors.bg }}>
      <ScrollView className="flex-1 px-6 pt-6">
        <Text className="text-2xl font-bold mb-6" style={{ color: colors.text }}>
          Timesheet
        </Text>

        {/* Status Card */}
        <View 
          className="rounded-xl p-4 mb-6" 
          style={{ backgroundColor: isClockedIn ? colors.success + '20' : colors.surface }}
        >
          <Text className="text-sm font-semibold mb-2" style={{ color: colors.muted }}>
            Status
          </Text>
          <Text className="text-2xl font-bold" style={{ 
            color: isClockedIn ? colors.success : isClockedOut ? colors.muted : colors.text 
          }}>
            {isClockedIn ? 'Clocked In' : isClockedOut ? 'Clocked Out' : 'Not Clocked In'}
          </Text>
        </View>

        {isClockedIn && (
          <View className="flex-row items-center mb-4" style={{ gap: 8 }}>
            <Ionicons
              name={isOnLunch ? "restaurant" : isOnPersonal ? "pause-circle" : "time-outline"}
              size={18}
              color={isOnBreak ? colors.accent : colors.success}
            />
            <Text className="text-sm font-semibold" style={{ color: colors.text }}>
              {isOnLunch
                ? "Lunch break active"
                : isOnPersonal
                  ? "Personal time active"
                  : "Active work session"}
            </Text>
          </View>
        )}

        {/* Session Details */}
        {session && (
          <View className="rounded-xl p-4 mb-6" style={{ backgroundColor: colors.surface }}>
            <Text className="text-sm font-semibold mb-3" style={{ color: colors.muted }}>
              Today&apos;s Session
            </Text>
            
            <View className="flex-row justify-between mb-2">
              <Text style={{ color: colors.text }}>Clock In:</Text>
              <Text className="font-semibold" style={{ color: colors.accent }}>
                {formatTime(session.clockInAt)}
              </Text>
            </View>
            
            {session.clockOutAt && (
              <View className="flex-row justify-between mb-2">
                <Text style={{ color: colors.text }}>Clock Out:</Text>
                <Text className="font-semibold" style={{ color: colors.accent }}>
                  {formatTime(session.clockOutAt)}
                </Text>
              </View>
            )}
            
            <View className="flex-row justify-between pt-3 mt-3" style={{ borderTopWidth: 1, borderTopColor: colors.bg }}>
              <Text className="font-semibold" style={{ color: colors.text }}>Duration:</Text>
              <Text className="font-bold text-lg" style={{ color: colors.success }}>
                {calculateDuration(session.clockInAt, session.clockOutAt)}
              </Text>
            </View>
          </View>
        )}

        {/* Break Section */}
        {isClockedIn && (
          <View className="rounded-xl p-4 mb-6" style={{ backgroundColor: isOnBreak ? colors.accent + '20' : colors.surface }}>
            <Text className="text-sm font-semibold mb-3" style={{ color: colors.muted }}>
              Breaks
            </Text>
            
            {isOnBreak && breakStartedAt ? (
              <>
                <View className="flex-row justify-between mb-3">
                  <Text style={{ color: colors.text }}>Started:</Text>
                  <Text className="font-semibold" style={{ color: colors.accent }}>
                    {formatTime(breakStartedAt)}
                  </Text>
                </View>
                <View className="flex-row justify-between mb-3">
                  <Text style={{ color: colors.text }}>Duration:</Text>
                  <Text className="font-semibold" style={{ color: colors.accent }}>
                    {calculateDuration(breakStartedAt)}
                  </Text>
                </View>
                <Text className="text-xs mb-3" style={{ color: colors.muted }}>
                  {isOnLunch
                    ? "Lunch stays on the clock and records break duration."
                    : "Personal time is tracked now and can later convert into auto clock-out/in."}
                </Text>
                <Pressable
                  onPress={handleEndBreak}
                  disabled={isProcessing}
                  className="rounded-xl px-4 py-2.5 mt-2"
                  style={{ backgroundColor: colors.success, opacity: isProcessing ? 0.5 : 1 }}
                >
                  {isProcessing ? (
                    <ActivityIndicator color={colors.text} />
                  ) : (
                    <Text className="font-semibold text-center" style={{ color: colors.text }}>
                      End {isOnLunch ? 'Lunch' : 'Personal Time'}
                    </Text>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                <Text className="text-xs mb-3" style={{ color: colors.muted }}>
                  Start a break only when no tickets are active in ENROUTE or ONSITE.
                </Text>
                <View className="flex-row" style={{ gap: 10 }}>
                  <Pressable
                    onPress={() => handleStartBreak('lunch')}
                    disabled={isProcessing}
                    className="flex-1 rounded-xl px-4 py-2.5"
                    style={{ backgroundColor: colors.accent, opacity: isProcessing ? 0.5 : 1 }}
                  >
                    {isProcessing ? (
                      <ActivityIndicator color={colors.text} />
                    ) : (
                      <Text className="font-semibold text-center" style={{ color: colors.text }}>
                        Start Lunch
                      </Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => handleStartBreak('personal')}
                    disabled={isProcessing}
                    className="flex-1 rounded-xl px-4 py-2.5"
                    style={{ backgroundColor: colors.primary, opacity: isProcessing ? 0.5 : 1 }}
                  >
                    {isProcessing ? (
                      <ActivityIndicator color={colors.text} />
                    ) : (
                      <Text className="font-semibold text-center" style={{ color: colors.text }}>
                        Personal Time
                      </Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
            
            <Text className="text-xs text-center mt-3" style={{ color: colors.muted }}>
              Lunch target: 30 minutes
            </Text>
          </View>
        )}

        {/* Clock In/Out Buttons */}
        <Pressable
          onPress={isClockedIn ? handleClockOut : handleClockIn}
          disabled={isProcessing || isOnBreak}
          className="rounded-xl px-5 py-3 mb-4"
          style={{ 
            backgroundColor: isClockedIn ? colors.danger : colors.success,
            opacity: (isProcessing || isOnBreak) ? 0.5 : 1,
          }}
        >
          {isProcessing ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Text className="text-base font-bold text-center" style={{ color: colors.text }}>
              {isClockedIn ? 'Clock Out' : isClockedOut ? 'Clock In (New Session)' : 'Clock In'}
            </Text>
          )}
        </Pressable>

        {isOnBreak && (
          <Text className="text-xs text-center mb-4" style={{ color: colors.muted }}>
            End your current break before clocking out
          </Text>
        )}

        {isClockedOut && (
          <Text className="text-xs text-center mb-4" style={{ color: colors.muted }}>
            Previous session ended. Clock in to start a new session.
          </Text>
        )}

      </ScrollView>

      {/* Ticket Selector Modal for End Day clock out */}
      <TicketSelectorModal
        visible={showTicketSelector}
        userId={user?.id || ''}
        onSelect={handleTicketSelected}
        onCancel={handleTicketSelectorCancel}
      />
    </View>
  );
}
