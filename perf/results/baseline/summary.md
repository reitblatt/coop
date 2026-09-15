# Coop resource measurement — baseline

Host: 8 cpu / 14.9 GiB · node v24.20.0 · 2026-09-15T17:34:34.474Z

## Startup

| metric | value |
| --- | --- |
| bootToReadyMs | 2558 |

## Processes — graphql

Total RSS: mean 557.2 MiB, max 582.6 MiB, trend 157.32 MiB/min over 45.5s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| api-server | 1 | 412.5 | 437.2 | 372 | 11 | 55 | 33.5 | 162.1 |
| worker | 1 | 144.7 | 145.4 | 104.1 | 11 | 29 | 0.2 | -4.78 |

## Processes — idle

Total RSS: mean 573.1 MiB, max 638 MiB, trend -154.61 MiB/min over 120.3s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| api-server | 1 | 296.9 | 329.9 | 260.9 | 11 | 26 | 0.5 | -78.69 |
| worker | 1 | 276.2 | 308.1 | 240.3 | 11 | 29 | 0.4 | -75.91 |

## Processes — ingest

Total RSS: mean 1037.9 MiB, max 1392.3 MiB, trend 1027.07 MiB/min over 45.3s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| api-server | 1 | 841.4 | 1180.9 | 806.1 | 11 | 70 | 42.7 | 962.06 |
| worker | 1 | 196.5 | 219.3 | 161.4 | 11 | 39 | 5.7 | 65.01 |

## Processes — ready

Total RSS: mean 308.9 MiB, max 311.7 MiB, trend 8.97 MiB/min over 45.4s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| api-server | 1 | 163.8 | 166.3 | 123.5 | 11 | 51 | 0.7 | 7.66 |
| worker | 1 | 145 | 145.4 | 104.7 | 11 | 29 | 0.2 | 1.3 |

## Processes — settle

Total RSS: mean 1403.5 MiB, max 1412.8 MiB, trend -8.08 MiB/min over 166.2s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| api-server | 1 | 1293.9 | 1302.7 | 1270.7 | 11 | 49 | 15.9 | -7.01 |
| worker | 1 | 109.6 | 111.6 | 87 | 11 | 47 | 11.3 | -1.07 |

## Processes — soak

Total RSS: mean 1299.4 MiB, max 1664.8 MiB, trend 76 MiB/min over 419.5s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| api-server | 1 | 1142.7 | 1451 | 1114.1 | 11 | 71 | 157.5 | 81.41 |
| worker | 1 | 156.7 | 221.2 | 128.1 | 11 | 41 | 31.8 | -5.41 |

## Containers — graphql

Total: 1191.9 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 501.4 | 536.9 | 5.1 | 762 |
| coop-hma-1 | 276.9 | 277.1 | 0.2 | 21 |
| coop-jaeger-1 | 9 | 9 | 0 | 13 |
| coop-otel-collector-1 | 57 | 57 | 0 | 11 |
| coop-postgres-1 | 55.2 | 56.2 | 54.3 | 16 |
| coop-redis-1 | 39 | 39.4 | 1.6 | 6 |
| coop-scylla-1 | 253.4 | 266.3 | 1.5 | 32 |

## Containers — idle

Total: 1174.9 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 495.6 | 537.2 | 3.5 | 762 |
| coop-hma-1 | 276.7 | 277.1 | 0.2 | 21 |
| coop-jaeger-1 | 9 | 9.2 | 0 | 13 |
| coop-otel-collector-1 | 57.1 | 57.5 | 0 | 11 |
| coop-postgres-1 | 45.5 | 46.5 | 2 | 13 |
| coop-redis-1 | 39.1 | 39.4 | 1.2 | 6 |
| coop-scylla-1 | 251.9 | 265 | 1.6 | 32 |

## Containers — ingest

Total: 3138.8 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 2096.9 | 2758.7 | 289.2 | 772 |
| coop-hma-1 | 177 | 276.9 | 0.4 | 21 |
| coop-jaeger-1 | 19.3 | 57.9 | 0 | 13 |
| coop-otel-collector-1 | 69.6 | 134.6 | 0 | 11 |
| coop-postgres-1 | 66.4 | 96 | 23 | 17 |
| coop-redis-1 | 18.6 | 39.7 | 4.3 | 12 |
| coop-scylla-1 | 691 | 858.5 | 61 | 32 |

## Containers — ready

Total: 1198.8 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 518.7 | 564.7 | 3.5 | 762 |
| coop-hma-1 | 276.6 | 277.1 | 0.2 | 21 |
| coop-jaeger-1 | 9 | 9 | 0 | 13 |
| coop-otel-collector-1 | 57.1 | 57.3 | 0 | 11 |
| coop-postgres-1 | 45.5 | 48.2 | 2.8 | 13 |
| coop-redis-1 | 39 | 39.3 | 1.2 | 6 |
| coop-scylla-1 | 252.9 | 264.8 | 9.7 | 32 |

## Containers — settle

Total: 3867.8 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 2393.6 | 2412.5 | 273.8 | 913 |
| coop-hma-1 | 27.3 | 27.5 | 0.4 | 22 |
| coop-jaeger-1 | 5.2 | 6.5 | 12 | 13 |
| coop-otel-collector-1 | 17.4 | 19.8 | 17.6 | 13 |
| coop-postgres-1 | 41.8 | 52.1 | 6.5 | 20 |
| coop-redis-1 | 5.2 | 6.5 | 8.9 | 10 |
| coop-scylla-1 | 1377.3 | 1389.6 | 39.7 | 54 |

## Containers — soak

Total: 3660.8 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 2428.9 | 3023.9 | 247.5 | 836 |
| coop-hma-1 | 43.2 | 107.7 | 0.4 | 22 |
| coop-jaeger-1 | 7.4 | 26.3 | 2.1 | 13 |
| coop-otel-collector-1 | 14.1 | 86.7 | 4.3 | 13 |
| coop-postgres-1 | 31.5 | 56.5 | 25 | 22 |
| coop-redis-1 | 10.8 | 30 | 3.8 | 12 |
| coop-scylla-1 | 1124.9 | 1442.8 | 45.1 | 45 |

## In-process heap — probe-server

| metric | first | last | max | trend/min |
| --- | --- | --- | --- | --- |
| rss MiB | 45.5 | 1274.9 | 1450.5 | |
| heapUsed MiB | 4.8 | 949.8 | 1317.3 | 108.5 |
| external MiB | 2 | 5.2 | 69.7 | |
| handles | | | 50 | |

## In-process heap — probe-worker

| metric | first | last | max | trend/min |
| --- | --- | --- | --- | --- |
| rss MiB | 47.4 | 116.9 | 307.3 | |
| heapUsed MiB | 4.8 | 56.6 | 138 | 0.23 |
| external MiB | 2 | 5 | 12 | |
| handles | | | 22 | |

## Load phases

| phase | scenario | conc | rps | p50 ms | p90 ms | p99 ms | errors | statuses |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| graphql | graphql-me | 25 | 1027.7 | 23.86 | 27.66 | 33.46 | 0 | {"200":46271} |
| ingest | items-async | 25 | 309.1 | 51.95 | 113.63 | 567.33 | 0 | {"202":14050} |
| ready | ready | 25 | 24.9 | 1001.45 | 1003.25 | 1012.42 | 0 | {"200":1125} |
| soak | mixed | 25 | 95.8 | 74.68 | 161.9 | 987.99 | 6 | {"200":28191,"202":12034,"401":11,"500":35,"200-gql-error":46,"err:ECONNRESET":6} |

## Disk footprint

| item | MiB |
| --- | --- |
| rootNodeModulesMib | 120 |
| serverNodeModulesMib | 389 |
| clientNodeModulesMib | 700 |
| dbNodeModulesMib | 93 |
| migratorNodeModulesMib | 86 |
| nodeModulesTotalMib | 1388 |
| serverTranspiledMib | 9 |
| clientBuildMib | 0 |
| checkoutMib | 2492 |
| serverPackages | 1330 |
| clientPackages | 878 |
| rootPackages | 326 |
| imageServerMib | 590 |
| imageServerBaseMib | 876 |
| imageClientMib | 1091 |

