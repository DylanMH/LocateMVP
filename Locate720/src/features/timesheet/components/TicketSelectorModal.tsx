/**
 * TicketSelectorModal - Modal for selecting first ticket worked on End Day clock out
 * Only shown when ending the work day, not for lunch or personal time
 */

import { useState, useEffect } from 'react';
import { Modal, View, Text, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { Q } from '@nozbe/watermelondb';
import { database } from '../../../db/database';
import Ticket from '../../../db/models/Ticket';
import { colors } from '../../../ui/colors';

interface TicketSelectorModalProps {
  visible: boolean;
  userId: string;
  onSelect: (ticketId: string) => void;
  onCancel: () => void;
}

export function TicketSelectorModal({ visible, userId, onSelect, onCancel }: TicketSelectorModalProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Load tickets when modal becomes visible
  useEffect(() => {
    if (!visible || !userId) return;

    const loadTickets = async () => {
      setLoading(true);
      try {
        const ticketsCollection = database.collections.get<Ticket>('tickets');
        const userTickets = await ticketsCollection
          .query(
            Q.where('assigned_tech_id', userId),
            Q.where('status', 'OPEN'), // Only show OPEN tickets
            Q.sortBy('due_at', Q.asc)
          )
          .fetch();
        
        console.log('[TicketSelector] Loaded', userTickets.length, 'open tickets for user', userId);
        setTickets(userTickets);
      } catch (error) {
        console.error('[TicketSelector] Failed to load tickets:', error);
      } finally {
        setLoading(false);
      }
    };

    loadTickets();
  }, [visible, userId]);

  const handleConfirm = () => {
    if (selectedId) {
      onSelect(selectedId);
    }
  };

  const handleSkip = () => {
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View 
        className="flex-1 justify-end"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
      >
        <View 
          className="rounded-t-3xl p-6"
          style={{ 
            backgroundColor: colors.surface,
            maxHeight: '80%',
          }}
        >
          {/* Header */}
          <View className="mb-4">
            <Text className="text-xl font-bold mb-2" style={{ color: colors.text }}>
              Select First Ticket Worked
            </Text>
            <Text className="text-sm" style={{ color: colors.muted }}>
              Choose the first ticket you worked on today (optional)
            </Text>
          </View>

          {/* Ticket List */}
          {loading ? (
            <View className="py-8 items-center">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : tickets.length === 0 ? (
            <View className="py-8 items-center">
              <Text style={{ color: colors.muted }}>No tickets available</Text>
            </View>
          ) : (
            <FlatList
              data={tickets}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => setSelectedId(item.id)}
                  className="p-4 mb-2 rounded-xl border"
                  style={{
                    backgroundColor: selectedId === item.id ? colors.surface : colors.bg,
                    borderColor: selectedId === item.id ? colors.primary : colors.muted,
                    borderWidth: 1,
                  }}
                >
                  <View className="flex-row justify-between items-center">
                    <View className="flex-1">
                      <Text 
                        className="text-base font-semibold mb-1" 
                        style={{ color: colors.text }}
                      >
                        {item.ticketNumber}
                      </Text>
                      <Text 
                        className="text-sm" 
                        style={{ color: colors.muted }}
                        numberOfLines={1}
                      >
                        {item.address}
                      </Text>
                    </View>
                    {selectedId === item.id && (
                      <View 
                        className="w-6 h-6 rounded-full items-center justify-center"
                        style={{ backgroundColor: colors.primary }}
                      >
                        <Text style={{ color: colors.surface }}>✓</Text>
                      </View>
                    )}
                  </View>
                </Pressable>
              )}
              style={{ maxHeight: 400 }}
            />
          )}

          {/* Actions */}
          <View className="flex-row mt-4 gap-3">
            <Pressable
              onPress={handleSkip}
              className="flex-1 py-4 rounded-xl items-center"
              style={{ backgroundColor: colors.bg }}
            >
              <Text className="text-base font-semibold" style={{ color: colors.text }}>
                Skip
              </Text>
            </Pressable>
            
            <Pressable
              onPress={handleConfirm}
              disabled={!selectedId}
              className="flex-1 py-4 rounded-xl items-center"
              style={{ 
                backgroundColor: selectedId ? colors.primary : colors.muted,
                opacity: selectedId ? 1 : 0.5,
              }}
            >
              <Text className="text-base font-semibold" style={{ color: colors.surface }}>
                Confirm
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
