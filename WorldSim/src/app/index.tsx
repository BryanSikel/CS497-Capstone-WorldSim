import AsyncStorage from '@react-native-async-storage/async-storage';
import { geoBounds, geoEqualEarth, geoPath } from 'd3-geo';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import CountryFlag from 'react-native-country-flag';
import {
  GestureHandlerRootView,
  PanGestureHandler,
  PinchGestureHandler,
  State,
} from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';
import { CONTINENT_CONFIGS, ContinentConfig } from '../data/continentDifficulty';
import { continentMap, continents } from '../data/continentMap';
const countriesData: any = require('../../assets/data/countries.json');
const countryFacts: any = require('../../assets/data/countryFacts.json');

function getCountryFacts(feature: any) {
  if (!feature) return null;
  const iso3 = feature.properties['ISO3166-1-Alpha-3'] || feature.properties.ISO_A3;
  const name = countryName(feature);
  return countryFacts[iso3] || countryFacts[name] || null;
}

function formatPopulation(value: number | undefined) {
  if (!value) return 'Not available';
  return value.toLocaleString('en-US');
}

function formatGdp(value: number | undefined) {
  if (!value) return 'Not available';
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toLocaleString('en-US')}`;
}

function ringBounds(ring: number[][]) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, minLat, maxLon, maxLat };
}

function ringCentroid(ring: number[][]): [number, number] {
  let sumLon = 0, sumLat = 0;
  for (const [lon, lat] of ring) {
    sumLon += lon;
    sumLat += lat;
  }
  return [sumLon / ring.length, sumLat / ring.length];
}

function angularDistance(a: [number, number], b: [number, number]) {
  let dLon = a[0] - b[0];
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  const dLat = a[1] - b[1];
  return Math.sqrt(dLon * dLon + dLat * dLat);
}

const OUTLYING_TERRITORY_THRESHOLD_DEGREES = 25;

function stripOutlyingTerritories(feature: any): any {
  if (feature.geometry?.type !== 'MultiPolygon') return feature;
  const polygons: number[][][][] = feature.geometry.coordinates;
  if (polygons.length <= 1) return feature;

  const withMeta = polygons.map((rings) => {
    const b = ringBounds(rings[0]);
    const area = (b.maxLon - b.minLon) * (b.maxLat - b.minLat);
    return { rings, area, centroid: ringCentroid(rings[0]) };
  });

  const main = withMeta.reduce((a, b) => (b.area > a.area ? b : a));
  const kept = withMeta.filter(
    (p) => angularDistance(p.centroid, main.centroid) <= OUTLYING_TERRITORY_THRESHOLD_DEGREES
  );
  if (kept.length === polygons.length) return feature;

  const newCoords = kept.map((p) => p.rings);
  return {
    ...feature,
    geometry: {
      type: newCoords.length > 1 ? 'MultiPolygon' : 'Polygon',
      coordinates: newCoords.length > 1 ? newCoords : newCoords[0],
    },
  };
}

const cleanedFeatures: any[] = countriesData.features.map(stripOutlyingTerritories);

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const mapWidth = screenWidth * 0.75;
const mapHeight = screenHeight;
const panelWidth = screenWidth * 0.25;
const pieceSize = 70;
const mapPadding = 24;

const HISTORY_STORAGE_KEY = 'worldsim_history';

type HistoryEntry = {
  id: string;
  continent: string;
  difficulty: string;
  totalTimeSeconds: number;
  countriesSolved: number;
  completedAt: string;
};

const DEFAULT_CONFIG: ContinentConfig = {
  name: 'All',
  difficulty: 'Medium',
  timeLimitSeconds: 25,
  dropToleranceRadius: 45,
  hintsAllowed: 3,
};

function getConfig(continent: string): ContinentConfig {
  return CONTINENT_CONFIGS[continent] || DEFAULT_CONFIG;
}

const CONTINENT_NAME_FALLBACK: Record<string, string> = {
  France: 'Europe',
  Norway: 'Europe',
};

function countryName(feature: any) {
  if (!feature) return '';
  return feature.properties.name || feature.properties.ADMIN || '';
}

function countryIso2(feature: any) {
  if (!feature) return '';
  return (feature.properties['ISO3166-1-Alpha-2'] || feature.properties.ISO_A2 || '').toLowerCase();
}

function getCountriesForContinent(continent: string) {
  if (!continent) return [];
  const filtered = cleanedFeatures.filter((f: any) => {
    const iso3 = f.properties['ISO3166-1-Alpha-3'] || f.properties.ISO_A3;
    const name = countryName(f);
    const mappedContinent = continentMap[iso3] || CONTINENT_NAME_FALLBACK[name];
    return mappedContinent === continent;
  });
  return filtered;
}

function pickRandomCountry(continent: string, solved: Set<string>) {
  const pool = getCountriesForContinent(continent);
  if (pool.length === 0) return null;
  const remaining = pool.filter((c: any) => !solved.has(countryName(c)));
  const chooseFrom = remaining.length > 0 ? remaining : pool;
  return chooseFrom[Math.floor(Math.random() * chooseFrom.length)];
}

const initialPieceX = mapWidth + panelWidth / 2 - pieceSize / 2;
const initialPieceY = 190;

export default function Index() {
  const [score, setScore] = useState(0);
  const [selectedContinent, setSelectedContinent] = useState('');
  const [targetCountry, setTargetCountry] = useState<any>(null);
  const [feedback, setFeedback] = useState('');
  const [hintsUsed, setHintsUsed] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [solvedShapes, setSolvedShapes] = useState<Set<string>>(new Set());
  const [solvedFlags, setSolvedFlags] = useState<Set<string>>(new Set());
  const [continentMenuOpen, setContinentMenuOpen] = useState(false);
  const [totalElapsedSeconds, setTotalElapsedSeconds] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [stage, setStage] = useState<'shapes' | 'flags'>('shapes');
  const [lastFact, setLastFact] = useState<{ name: string; population?: number; gdp?: number } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyVisible, setHistoryVisible] = useState(false);

  const solvedCountries = stage === 'shapes' ? solvedShapes : solvedFlags;

  const config = useMemo(() => getConfig(selectedContinent), [selectedContinent]);
  const hintsRemaining = config.hintsAllowed - hintsUsed;

  const visibleCountries = useMemo(
    () => getCountriesForContinent(selectedContinent),
    [selectedContinent]
  );

  const solvedCount = solvedCountries.size;
  const totalCount = visibleCountries.length;
  const percentSolved = totalCount > 0 ? Math.round((solvedCount / totalCount) * 100) : 0;

  const projection = useMemo(() => {
    if (visibleCountries.length === 0) return null;
    const featureCollection = { type: 'FeatureCollection', features: visibleCountries };
    return geoEqualEarth().fitExtent(
      [
        [mapPadding, mapPadding],
        [mapWidth - mapPadding, mapHeight - mapPadding],
      ],
      featureCollection as any
    );
  }, [visibleCountries]);

  const pathGenerator = useMemo(() => {
    if (!projection) return null;
    return geoPath().projection(projection as any);
  }, [projection]);

  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const baseScale = useRef(new Animated.Value(1)).current;
  const pinchScale = useRef(new Animated.Value(1)).current;
  const scale = useRef(Animated.multiply(baseScale, pinchScale)).current;
  const lastScale = useRef(1);

  const baseTranslateX = useRef(new Animated.Value(0)).current;
  const baseTranslateY = useRef(new Animated.Value(0)).current;
  const panDeltaX = useRef(new Animated.Value(0)).current;
  const panDeltaY = useRef(new Animated.Value(0)).current;
  const translateX = useRef(Animated.add(baseTranslateX, panDeltaX)).current;
  const translateY = useRef(Animated.add(baseTranslateY, panDeltaY)).current;
  const lastTranslateX = useRef(0);
  const lastTranslateY = useRef(0);

  const pinchRef = useRef(null);
  const panMapRef = useRef(null);

  const onPinchGestureEvent = Animated.event(
    [{ nativeEvent: { scale: pinchScale } }],
    { useNativeDriver: true }
  );

  function onPinchHandlerStateChange(event: any) {
    if (event.nativeEvent.oldState === State.ACTIVE) {
      let newScale = lastScale.current * event.nativeEvent.scale;
      newScale = Math.min(Math.max(newScale, 1), 6);
      lastScale.current = newScale;
      baseScale.setValue(newScale);
      pinchScale.setValue(1);
    }
  }

  const onPanMapGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: panDeltaX, translationY: panDeltaY } }],
    { useNativeDriver: true }
  );

  function onPanMapHandlerStateChange(event: any) {
    if (event.nativeEvent.oldState === State.ACTIVE) {
      lastTranslateX.current += event.nativeEvent.translationX;
      lastTranslateY.current += event.nativeEvent.translationY;
      baseTranslateX.setValue(lastTranslateX.current);
      baseTranslateY.setValue(lastTranslateY.current);
      panDeltaX.setValue(0);
      panDeltaY.setValue(0);
    }
  }

  const miniPath = useMemo(() => {
    if (!targetCountry) return '';
    const proj = geoEqualEarth();
    proj.fitSize([pieceSize, pieceSize], targetCountry);
    const gen = geoPath().projection(proj as any);
    return gen(targetCountry);
  }, [targetCountry]);

  const targetBoundsPixels = useMemo(() => {
    if (!targetCountry || !projection) return null;
    const bounds = geoBounds(targetCountry);
    const p1 = projection(bounds[0] as [number, number]);
    const p2 = projection(bounds[1] as [number, number]);
    if (!p1 || !p2) return null;
    return {
      minX: Math.min(p1[0], p2[0]),
      maxX: Math.max(p1[0], p2[0]),
      minY: Math.min(p1[1], p2[1]),
      maxY: Math.max(p1[1], p2[1]),
    };
  }, [targetCountry, projection]);

  function resetPieceToPanel() {
    pan.setValue({ x: 0, y: 0 });
  }

  function newTarget(continent: string, solved: Set<string>) {
    setTargetCountry(pickRandomCountry(continent, solved));
    setFeedback('');
    setHintsUsed(0);
    setElapsedSeconds(0);
    resetPieceToPanel();
  }

  function handleSkip() {
    if (!selectedContinent) return;
    newTarget(selectedContinent, solvedCountries);
  }

  function handleContinentChange(continent: string) {
    setSelectedContinent(continent);
    setSolvedShapes(new Set());
    setSolvedFlags(new Set());
    setContinentMenuOpen(false);
    setTotalElapsedSeconds(0);
    setIsComplete(false);
    setStage('shapes');
    setLastFact(null);
    newTarget(continent, new Set());
    lastScale.current = 1;
    baseScale.setValue(1);
    pinchScale.setValue(1);
    lastTranslateX.current = 0;
    lastTranslateY.current = 0;
    baseTranslateX.setValue(0);
    baseTranslateY.setValue(0);
    panDeltaX.setValue(0);
    panDeltaY.setValue(0);
  }

  function handleHint() {
    if (hintsRemaining <= 0 || !targetCountry) return;
    setHintsUsed((h) => h + 1);
    setFeedback(countryName(targetCountry));
  }

  useEffect(() => {
    if (!selectedContinent || !targetCountry) return;
    const timer = setInterval(() => setElapsedSeconds((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [selectedContinent, targetCountry]);

  useEffect(() => {
    if (!selectedContinent || isComplete) return;
    const timer = setInterval(() => setTotalElapsedSeconds((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [selectedContinent, isComplete]);

  useEffect(() => {
    AsyncStorage.getItem(HISTORY_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setHistory(parsed);
        } catch {
          // ignore corrupted storage, start with an empty history
        }
      })
      .catch(() => {});
  }, []);

  function recordCompletion(continentName: string, difficultyLabel: string, timeSeconds: number, countSolved: number) {
    const entry: HistoryEntry = {
      id: `${Date.now()}`,
      continent: continentName,
      difficulty: difficultyLabel,
      totalTimeSeconds: timeSeconds,
      countriesSolved: countSolved,
      completedAt: new Date().toISOString(),
    };
    setHistory((prev) => {
      const next = [entry, ...prev];
      AsyncStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function formatTime(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  function handlePlayAgain() {
    setSolvedShapes(new Set());
    setSolvedFlags(new Set());
    setTotalElapsedSeconds(0);
    setIsComplete(false);
    setStage('shapes');
    setLastFact(null);
    newTarget(selectedContinent, new Set());
  }

  function handleStartFlagStage() {
    setSolvedFlags(new Set());
    setIsComplete(false);
    setStage('flags');
    newTarget(selectedContinent, new Set());
  }

  function handleChangeContinent() {
    setSelectedContinent('');
    setSolvedShapes(new Set());
    setSolvedFlags(new Set());
    setTotalElapsedSeconds(0);
    setIsComplete(false);
    setStage('shapes');
    setTargetCountry(null);
    setFeedback('');
    setLastFact(null);
  }

  function handleDrop(offsetX: number, offsetY: number) {
    const dropX = initialPieceX + offsetX;
    const dropY = initialPieceY + offsetY;
    const screenCenterX = dropX + pieceSize / 2;
    const screenCenterY = dropY + pieceSize / 2;

    const mapOriginX = mapWidth / 2;
    const mapOriginY = mapHeight / 2;
    const s = lastScale.current;

    const mapCenterX =
      (screenCenterX - lastTranslateX.current - mapOriginX * (1 - s)) / s;
    const mapCenterY =
      (screenCenterY - lastTranslateY.current - mapOriginY * (1 - s)) / s;

    const b = targetBoundsPixels;
    const tolerance = config.dropToleranceRadius;
    const hit =
      b &&
      mapCenterX >= b.minX - tolerance &&
      mapCenterX <= b.maxX + tolerance &&
      mapCenterY >= b.minY - tolerance &&
      mapCenterY <= b.maxY + tolerance;

    if (hit && b) {
      setScore((s) => s + 1);
      setFeedback('Correct!');
      const solvedName = countryName(targetCountry);
      const nextSolved = new Set(solvedCountries);
      nextSolved.add(solvedName);
      if (stage === 'shapes') {
        setSolvedShapes(nextSolved);
      } else {
        setSolvedFlags(nextSolved);
      }
      const facts = getCountryFacts(targetCountry);
      setLastFact({
        name: solvedName,
        population: facts?.population,
        gdp: stage === 'flags' ? facts?.gdp : undefined,
      });
      const justCompleted = nextSolved.size === totalCount;

      const targetMapX = (b.minX + b.maxX) / 2;
      const targetMapY = (b.minY + b.maxY) / 2;
      const targetScreenX =
        targetMapX * s + mapOriginX * (1 - s) + lastTranslateX.current - pieceSize / 2;
      const targetScreenY =
        targetMapY * s + mapOriginY * (1 - s) + lastTranslateY.current - pieceSize / 2;

      Animated.spring(pan, {
        toValue: { x: targetScreenX - initialPieceX, y: targetScreenY - initialPieceY },
        useNativeDriver: true,
      }).start(() => {
        setTimeout(() => {
          if (justCompleted) {
            if (stage === 'flags') {
              recordCompletion(selectedContinent, config.difficulty, totalElapsedSeconds, totalCount);
            }
            setIsComplete(true);
            setTargetCountry(null);
          } else {
            newTarget(selectedContinent, nextSolved);
          }
        }, 700);
      });
    } else {
      setFeedback('Try again');
      Animated.spring(pan, {
        toValue: { x: 0, y: 0 },
        useNativeDriver: true,
      }).start();
    }
  }

  const pieceGestureRef = useRef(null);

  const onPieceGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: pan.x, translationY: pan.y } }],
    { useNativeDriver: true }
  );

  function onPieceHandlerStateChange(event: any) {
    if (event.nativeEvent.oldState === State.ACTIVE) {
      const offsetX = event.nativeEvent.translationX;
      const offsetY = event.nativeEvent.translationY;
      handleDrop(offsetX, offsetY);
    }
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={styles.container}>
        <View style={styles.row}>
          <View style={{ width: mapWidth, height: mapHeight, overflow: 'hidden' }}>
            {!selectedContinent ? (
              <View style={styles.emptyMap}>
                <Text style={styles.emptyMapText}>Pick a continent to start</Text>
              </View>
            ) : visibleCountries.length === 0 ? (
              <View style={styles.emptyMap}>
                <Text style={styles.emptyMapText}>No countries matched "{selectedContinent}"</Text>
              </View>
            ) : (
              <PanGestureHandler
                ref={panMapRef}
                simultaneousHandlers={pinchRef}
                onGestureEvent={onPanMapGestureEvent}
                onHandlerStateChange={onPanMapHandlerStateChange}
              >
                <Animated.View style={{ flex: 1 }}>
                  <PinchGestureHandler
                    ref={pinchRef}
                    simultaneousHandlers={panMapRef}
                    onGestureEvent={onPinchGestureEvent}
                    onHandlerStateChange={onPinchHandlerStateChange}
                  >
                    <Animated.View
                      style={[
                        { width: mapWidth, height: mapHeight },
                        { transform: [{ translateX }, { translateY }, { scale }] },
                      ]}
                    >
                      <Svg width={mapWidth} height={mapHeight} viewBox={`0 0 ${mapWidth} ${mapHeight}`}>
                        {pathGenerator &&
                          visibleCountries.map((feature: any, index: number) => {
                            const path = pathGenerator(feature);
                            const name = countryName(feature);
                            const isFlagSolved = solvedFlags.has(name);
                            const isShapeSolved = solvedShapes.has(name);
                            const isTarget = name === countryName(targetCountry);
                            const fill = isFlagSolved
                              ? '#023e8a'
                              : isShapeSolved
                              ? '#2a9d8f'
                              : isTarget && feedback === 'Correct!'
                              ? '#ffb703'
                              : '#8ecae6';
                            return (
                              <Path key={index} d={path || ''} fill={fill} stroke="#333" strokeWidth={0.5} />
                            );
                          })}
                      </Svg>
                    </Animated.View>
                  </PinchGestureHandler>
                </Animated.View>
              </PanGestureHandler>
            )}
          </View>

          <View style={styles.panel}>
            <View style={styles.scoreRow}>
              <Text style={styles.score}>Score: {score}</Text>
              <Pressable style={styles.historyButton} onPress={() => setHistoryVisible(true)}>
                <Text style={styles.historyButtonText}>History</Text>
              </Pressable>
            </View>
            {selectedContinent ? (
              <>
                <Text style={styles.progress}>
                  {solvedCount} / {totalCount} solved ({percentSolved}%)
                </Text>
                <Text style={styles.difficulty}>
                  {config.difficulty} · {stage === 'shapes' ? 'Stage 1: Shapes' : 'Stage 2: Flags'} · Total {formatTime(totalElapsedSeconds)} · Round {elapsedSeconds}s
                </Text>
              </>
            ) : (
              <Text style={styles.difficulty}>No continent selected</Text>
            )}

            {selectedContinent ? (
              <>
                <Pressable
                  style={styles.continentDropdownHeader}
                  onPress={() => setContinentMenuOpen((o) => !o)}
                >
                  <Text style={styles.continentDropdownText}>
                    {selectedContinent} {continentMenuOpen ? '▲' : '▼'}
                  </Text>
                </Pressable>
                {continentMenuOpen && (
                  <ScrollView style={styles.continentList}>
                    {continents.map((c) => (
                      <Pressable
                        key={c}
                        onPress={() => handleContinentChange(c)}
                        style={[
                          styles.continentButton,
                          selectedContinent === c && styles.continentButtonActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.continentButtonText,
                            selectedContinent === c && styles.continentButtonTextActive,
                          ]}
                        >
                          {c}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </>
            ) : (
              <>
                <Text style={styles.sectionLabel}>Continent</Text>
                <ScrollView style={styles.continentList}>
                  {continents.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => handleContinentChange(c)}
                      style={styles.continentButton}
                    >
                      <Text style={styles.continentButtonText}>{c}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )}

            <Text style={styles.instructions}>
              {stage === 'shapes' ? 'Drag this shape onto the map' : 'Drag this flag onto its country'}
            </Text>
            {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}

            <Pressable
              style={[styles.hintButton, hintsRemaining <= 0 && styles.hintButtonDisabled]}
              onPress={handleHint}
              disabled={hintsRemaining <= 0}
            >
              <Text style={styles.skipButtonText}>Hint ({hintsRemaining})</Text>
            </Pressable>

            <Pressable style={styles.skipButton} onPress={handleSkip}>
              <Text style={styles.skipButtonText}>Skip</Text>
            </Pressable>
          </View>
        </View>

        {lastFact && (
          <View style={styles.factCardFloating} pointerEvents="none">
            <Text style={styles.factName}>{lastFact.name}</Text>
            <Text style={styles.factLine}>Population: {formatPopulation(lastFact.population)}</Text>
            {lastFact.gdp !== undefined && (
              <Text style={styles.factLine}>GDP: {formatGdp(lastFact.gdp)}</Text>
            )}
          </View>
        )}

        {targetCountry && (
          <View style={styles.overlay} pointerEvents="box-none">
            <PanGestureHandler
              ref={pieceGestureRef}
              onGestureEvent={onPieceGestureEvent}
              onHandlerStateChange={onPieceHandlerStateChange}
            >
              <Animated.View
                style={[
                  styles.draggable,
                  {
                    left: initialPieceX,
                    top: initialPieceY,
                    transform: [{ translateX: pan.x }, { translateY: pan.y }],
                  },
                ]}
              >
                {stage === 'shapes' ? (
                  <Svg width={pieceSize} height={pieceSize} viewBox={`0 0 ${pieceSize} ${pieceSize}`}>
                    <Path d={miniPath || ''} fill="#e63946" stroke="#333" strokeWidth={1} />
                  </Svg>
                ) : (
                  <View style={styles.flagPiece}>
                    <CountryFlag isoCode={countryIso2(targetCountry)} size={pieceSize} />
                  </View>
                )}
              </Animated.View>
            </PanGestureHandler>
          </View>
        )}

        {isComplete && stage === 'shapes' && (
          <View style={styles.completeOverlay}>
            <View style={styles.completeCard}>
              <Text style={styles.completeTitle}>{selectedContinent} Shapes Complete!</Text>
              <Text style={styles.completeStat}>Time so far: {formatTime(totalElapsedSeconds)}</Text>
              <Text style={styles.completeStat}>Countries: {totalCount} / {totalCount}</Text>
              <Pressable style={styles.playAgainButton} onPress={handleStartFlagStage}>
                <Text style={styles.skipButtonText}>Next: Match Flags</Text>
              </Pressable>
              <Pressable style={styles.changeContinentButton} onPress={handleChangeContinent}>
                <Text style={styles.skipButtonText}>Choose Another Continent</Text>
              </Pressable>
            </View>
          </View>
        )}

        {isComplete && stage === 'flags' && (
          <View style={styles.completeOverlay}>
            <View style={styles.completeCard}>
              <Text style={styles.completeTitle}>{selectedContinent} Complete!</Text>
              <Text style={styles.completeStat}>Total Time: {formatTime(totalElapsedSeconds)}</Text>
              <Text style={styles.completeStat}>Countries: {totalCount} / {totalCount}</Text>
              <Pressable style={styles.playAgainButton} onPress={handlePlayAgain}>
                <Text style={styles.skipButtonText}>Play Again</Text>
              </Pressable>
              <Pressable style={styles.changeContinentButton} onPress={handleChangeContinent}>
                <Text style={styles.skipButtonText}>Choose Another Continent</Text>
              </Pressable>
            </View>
          </View>
        )}

        {historyVisible && (
          <View style={styles.completeOverlay}>
            <View style={styles.historyCard}>
              <Text style={[styles.completeTitle, { textAlign: 'center' }]}>Past Attempts</Text>
              {history.length === 0 ? (
                <Text style={styles.historyEmptyText}>
                  No completed continents yet. Finish both stages of a continent to see it here.
                </Text>
              ) : (
                <ScrollView style={styles.historyList}>
                  {history.map((entry) => (
                    <View key={entry.id} style={styles.historyRow}>
                      <Text style={styles.historyRowTitle}>
                        {entry.continent} · {entry.difficulty}
                      </Text>
                      <Text style={styles.historyRowDetail}>
                        {formatTime(entry.totalTimeSeconds)} · {entry.countriesSolved} countries
                      </Text>
                      <Text style={styles.historyRowDate}>
                        {new Date(entry.completedAt).toLocaleDateString()}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              )}
              <Pressable style={styles.changeContinentButton} onPress={() => setHistoryVisible(false)}>
                <Text style={styles.skipButtonText}>Close</Text>
              </Pressable>
            </View>
          </View>
        )}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  row: { flex: 1, flexDirection: 'row' },
  emptyMap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef2f5',
  },
  emptyMapText: { fontSize: 16, color: '#777' },
  panel: {
    width: panelWidth,
    padding: 12,
    backgroundColor: '#f1f1f1',
    borderLeftWidth: 1,
    borderLeftColor: '#ccc',
  },
  score: { fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  historyButton: {
    backgroundColor: '#e0e0e0',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  historyButtonText: { fontSize: 12, fontWeight: '600', color: '#333' },
  historyCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 24,
    alignItems: 'stretch',
    width: 300,
    maxHeight: '70%',
  },
  historyEmptyText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginVertical: 20,
  },
  historyList: { marginBottom: 12 },
  historyRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  historyRowTitle: { fontSize: 14, fontWeight: 'bold', color: '#222' },
  historyRowDetail: { fontSize: 13, color: '#444', marginTop: 2 },
  historyRowDate: { fontSize: 11, color: '#999', marginTop: 2 },
  progress: { fontSize: 13, color: '#333', marginBottom: 2 },
  difficulty: { fontSize: 13, color: '#555', marginBottom: 8 },
  sectionLabel: { fontSize: 13, fontWeight: '600', marginBottom: 4, color: '#555' },
  factCardFloating: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 210,
    backgroundColor: 'rgba(233, 245, 243, 0.95)',
    borderRadius: 10,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  factName: { fontSize: 14, fontWeight: 'bold', color: '#023e8a', marginBottom: 2 },
  factLine: { fontSize: 12, color: '#333' },
  continentDropdownHeader: {
    backgroundColor: '#219ebc',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginBottom: 8,
  },
  continentDropdownText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  continentList: { maxHeight: 160, marginBottom: 10 },
  continentButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 4,
    backgroundColor: '#e0e0e0',
  },
  continentButtonActive: { backgroundColor: '#219ebc' },
  continentButtonText: { fontSize: 13, color: '#333' },
  continentButtonTextActive: { color: '#fff', fontWeight: 'bold' },
  instructions: { fontSize: 13, marginBottom: 8 },
  feedback: { fontSize: 16, fontWeight: 'bold', color: '#2a9d8f', marginBottom: 8 },
  hintButton: {
    backgroundColor: '#219ebc',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 8,
  },
  hintButtonDisabled: {
    backgroundColor: '#aaa',
  },
  skipButton: {
    backgroundColor: '#e63946',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  skipButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: screenWidth,
    height: screenHeight,
  },
  draggable: {
    position: 'absolute',
    width: pieceSize,
    height: pieceSize,
  },
  flagPiece: {
    width: pieceSize,
    height: pieceSize,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333',
    overflow: 'hidden',
  },
  completeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: screenWidth,
    height: screenHeight,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: 280,
  },
  completeTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 16, color: '#222' },
  completeStat: { fontSize: 16, color: '#444', marginBottom: 6 },
  playAgainButton: {
    backgroundColor: '#2a9d8f',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 16,
    width: '100%',
    alignItems: 'center',
  },
  changeContinentButton: {
    backgroundColor: '#219ebc',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 10,
    width: '100%',
    alignItems: 'center',
  },
});